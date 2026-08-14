"""Book Purchase & Order Management (Module 3 enhanced).

Owns product/variant catalogue, inventory with a reserved pool, the full order
lifecycle with a status timeline, activation-code reservation on payment,
office-pickup OTP/QR issuance and verification, and cancellation/release.

Courier dispatch and SMS/WhatsApp are wired through stubs (app.shared.messaging
+ tracking fields) so a live provider drops in without call-site changes."""
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from bson import ObjectId

from app.core.config import settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.db.base import utcnow
from app.db.models import (
    ActivationCode,
    BookOrder,
    BookProduct,
    BookVersion,
    CodeStatus,
    InventoryTransaction,
    OrderStatus,
    Payment,
    PaymentStatus,
    RefundStatus,
)
from app.modules.notification import service as notif
from app.shared import messaging, pdf_service

# Statuses at/after which inventory is committed and a plain cancel is blocked.
_SHIPPED_STATES = {
    OrderStatus.shipped, OrderStatus.in_transit, OrderStatus.out_for_delivery,
    OrderStatus.delivered, OrderStatus.collected, OrderStatus.activation_pending,
    OrderStatus.completed,
}


def _order_number() -> str:
    return f"SPK-ORD-{datetime.utcnow():%Y%m}-{secrets.token_hex(3).upper()}"


def _push_status(order: BookOrder, status: OrderStatus, note: str | None = None,
                 by: str | None = None) -> None:
    order.status = status
    order.status_history.append({
        "status": status.value,
        "at": utcnow().isoformat(),
        "note": note,
        "by": by,
    })


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# --------------------------------------------------------------------------
# Products & inventory
# --------------------------------------------------------------------------
async def create_product(data: dict) -> BookProduct:
    if await BookProduct.find_one(BookProduct.sku == data["sku"]):
        raise ConflictError("A product with this SKU already exists")
    product = BookProduct(**data)
    await product.insert()
    return product


async def get_product(product_id: str) -> BookProduct:
    product = await BookProduct.get(product_id)
    if not product:
        raise NotFoundError("Product not found")
    return product


async def get_speakedge_book() -> BookProduct | None:
    return await BookProduct.find_one({
        "is_speakedge_book": True, "status": "active",
        "visible": True, "is_archived": False,
    })


async def clear_other_speakedge_books(product_id: str) -> None:
    """Exactly one product may be the SpeakEdge Book; flagging a new one
    unflags the previous holder."""
    await BookProduct.find({"is_speakedge_book": True, "_id": {"$ne": ObjectId(product_id)}}).update(
        {"$set": {"is_speakedge_book": False}}
    )


async def build_receipt(order: BookOrder) -> bytes:
    """Line-itemised PDF receipt for an order (membership + book + delivery)."""
    lines: list[tuple[str, int]] = []
    if order.plan:
        from app.modules.payments import service as pay  # avoids an import cycle
        try:
            label = (await pay.get_plan_config(order.plan)).label
        except NotFoundError:
            label = order.plan
        # The upfront charge is the one-time admission fee; any monthly fee is
        # billed separately, so the line must not read as a term price.
        lines.append((f"{label} Membership (one-time admission fee)", order.plan_amount))
    product = await BookProduct.get(order.product_id) if order.product_id else None
    lines.append((product.name if product else "SpeakEdge Book", order.book_amount))
    if order.gst_amount:
        lines.append(("GST", order.gst_amount))
    lines.append((
        "Home delivery" if order.delivery_type == "home" else "Office pickup",
        order.delivery_charge,
    ))
    address = ", ".join(filter(None, [
        order.address_line1, order.address_line2, order.city, order.district,
        order.state, order.pin_code,
    ])) if order.delivery_type == "home" else "Office pickup"
    return pdf_service.order_receipt_bytes(
        order_number=order.order_number, buyer_name=order.buyer_name, phone=order.phone,
        status=order.status.value, lines=lines, total_paise=order.amount,
        placed_on=order.created_at or utcnow(), address=address,
    )


async def archive_product(product_id: str, actor: str, reason: str | None = None) -> BookProduct:
    product = await get_product(product_id)
    if product.is_archived:
        raise ConflictError("Product is already archived")
    if product.reserved > 0:
        raise ConflictError("Cannot delete a product with reserved stock for pending orders")
    product.archive(actor, reason or "deleted by admin")
    product.status = "inactive"
    product.visible = False
    await product.save()
    return product


async def adjust_inventory(product_id: str, kind: str, qty: int, *, actor: str,
                           reason: str | None = None, order_id: str | None = None) -> BookProduct:
    """Apply an inventory movement and append a transaction log.

    kind: restock (+stock) | adjust (±stock) | reserve (+reserved) |
          release (-reserved) | ship (-stock, -reserved)
    """
    product = await get_product(product_id)
    if kind == "restock":
        product.stock += qty
    elif kind == "adjust":
        product.stock = max(0, product.stock + qty)
    elif kind == "reserve":
        if product.available < qty:
            raise ConflictError("Insufficient available stock to reserve")
        product.reserved += qty
    elif kind == "release":
        product.reserved = max(0, product.reserved - qty)
    elif kind == "ship":
        product.stock = max(0, product.stock - qty)
        product.reserved = max(0, product.reserved - qty)
    else:
        raise ValidationAppError("Invalid inventory movement")
    product.touch()
    await product.save()
    await InventoryTransaction(
        product_id=product_id, change=qty, kind=kind, reason=reason,
        order_id=order_id, stock_after=product.stock, reserved_after=product.reserved,
        actor=actor,
    ).insert()
    return product


# --------------------------------------------------------------------------
# Checkout
# --------------------------------------------------------------------------
async def create_checkout(*, buyer_name: str, phone: str, delivery_type: str,
                          product_id: str | None = None, version: str | None = None,
                          plan: str | None = None, months: int | None = None,
                          email: str | None = None, alt_phone: str | None = None,
                          address_line1: str | None = None, address_line2: str | None = None,
                          landmark: str | None = None, state: str | None = None,
                          district: str | None = None, city: str | None = None,
                          pin_code: str | None = None,
                          delivery_instructions: str | None = None) -> dict:
    if delivery_type not in ("office", "home"):
        raise ValidationAppError("delivery_type must be 'office' or 'home'")
    if delivery_type == "home" and not (address_line1 and pin_code):
        raise ValidationAppError("Home delivery requires at least address_line1 and PIN code")

    # Price: product catalogue when given, else the legacy flat book price.
    product = None
    if product_id:
        product = await get_product(product_id)
        if product.status != "active" or not product.visible:
            raise ConflictError("This product is not available for purchase")
        if product.available <= 0:
            raise ConflictError("This product is out of stock")
        book_amount = product.sell_price
        gst_amount = round(book_amount * product.gst_rate / 100)
        version = product.version.value
    else:
        book_amount = settings.BOOK_PRICE_PAISE
        gst_amount = 0

    # Reuse the payments gateway/pricing helpers (lazy import avoids a cycle).
    from app.modules.payments import service as pay

    # Membership bundled in (SpeakEdge Book route): one order, one payment.
    plan_amount = 0
    if plan:
        if product and not product.is_speakedge_book:
            raise ValidationAppError("Only the SpeakEdge Book can be bundled with a membership")
        cfg = await pay.get_plan_config(plan)
        if not cfg.enabled:
            raise ValidationAppError("This plan is not currently available")
        months = pay._normalize_months(cfg, months)
        plan_amount = pay._price_for(cfg, months)
    elif product and product.is_speakedge_book:
        raise ValidationAppError("Choose a membership plan before buying the SpeakEdge Book")

    delivery_charge = settings.BOOK_DELIVERY_CHARGE_PAISE if delivery_type == "home" else 0
    amount = book_amount + delivery_charge + gst_amount + plan_amount

    order_id = await pay._create_gateway_order(
        amount, {"kind": "book", "buyer": buyer_name, "plan": plan or ""}
    )

    payment = Payment(
        student_id=f"guest:{phone}", kind="book", plan=plan, months=months, amount=amount,
        status=PaymentStatus.created, payment_mode="razorpay", razorpay_order_id=order_id,
        # The router refuses the checkout unless the buyer accepted the Terms.
        terms_accepted_at=utcnow(), terms_version=settings.TERMS_VERSION,
    )
    await payment.insert()

    order = BookOrder(
        order_number=_order_number(),
        product_id=product_id,
        version=BookVersion(version) if version else None,
        buyer_name=buyer_name, phone=phone, alt_phone=alt_phone, email=email,
        delivery_type=delivery_type, address_line1=address_line1, address_line2=address_line2,
        landmark=landmark, state=state, district=district, city=city, pin_code=pin_code,
        delivery_instructions=delivery_instructions,
        plan=plan, plan_months=months, plan_amount=plan_amount,
        book_amount=book_amount, delivery_charge=delivery_charge, gst_amount=gst_amount,
        amount=amount, status=OrderStatus.payment_pending, payment_id=str(payment.id),
    )
    _push_status(order, OrderStatus.payment_pending, "Checkout created")
    await order.insert()
    return {
        "order_number": order.order_number, "book_order_id": str(order.id),
        "order_id": order_id, "amount": amount, "book_amount": book_amount,
        "delivery_charge": delivery_charge, "gst_amount": gst_amount,
        "plan": plan, "plan_months": months, "plan_amount": plan_amount,
        "currency": "INR", "key_id": settings.RAZORPAY_KEY_ID,
    }


# --------------------------------------------------------------------------
# Post-payment fulfilment (called by payments._fulfil)
# --------------------------------------------------------------------------
async def _reserve_activation_code(order: BookOrder) -> str | None:
    """Reserve one unused activation code for this order (single-use, atomic).

    A membership bundled into the order rides along on the code, so activating
    it later starts the subscription the buyer already paid for.
    """
    if order.activation_code:
        return order.activation_code
    for _ in range(5):
        code = await ActivationCode.find_one(ActivationCode.status == CodeStatus.unused)
        if not code:
            return None  # pool exhausted — admin assigns manually later
        res = await ActivationCode.find(
            ActivationCode.id == code.id, ActivationCode.status == CodeStatus.unused
        ).update({"$set": {"status": CodeStatus.reserved.value,
                           "activated_student_id": None,
                           "plan": order.plan,
                           "plan_months": order.plan_months}})
        if getattr(res, "modified_count", 0):
            return code.code
    return None


async def on_book_order_paid(payment: Payment) -> None:
    """Idempotent: confirm order, reserve inventory + activation code, notify."""
    order = await BookOrder.find_one(BookOrder.payment_id == str(payment.id))
    if not order or order.status not in (OrderStatus.draft, OrderStatus.payment_pending,
                                         OrderStatus.payment_success):
        return

    _push_status(order, OrderStatus.confirmed, "Payment captured")

    if order.product_id:
        try:
            await adjust_inventory(order.product_id, "reserve", 1, actor="system",
                                   reason="order paid", order_id=str(order.id))
            _push_status(order, OrderStatus.inventory_reserved)
        except ConflictError:
            order.internal_notes = (order.internal_notes or "") + " [stock unavailable at payment]"

    order.activation_code = await _reserve_activation_code(order)

    if order.delivery_type == "office":
        _issue_pickup(order)
        _push_status(order, OrderStatus.pickup_ready, "Ready for office collection")
    else:
        _push_status(order, OrderStatus.ready_for_dispatch)

    await order.save()

    msg = f"SpeakEdge order {order.order_number} confirmed. Amount ₹{order.amount / 100:.0f}."
    messaging.send_sms(order.phone, msg)
    messaging.send_whatsapp(order.alt_phone or order.phone, msg)
    if order.student_id and not order.student_id.startswith("guest:"):
        await notif.notify(order.student_id, "Book Order Confirmed", msg, kind="success")


# --------------------------------------------------------------------------
# Admin lifecycle transitions
# --------------------------------------------------------------------------
_ADMIN_TRANSITIONS = {
    OrderStatus.packed, OrderStatus.shipment_created, OrderStatus.shipped,
    OrderStatus.in_transit, OrderStatus.out_for_delivery, OrderStatus.delivered,
    OrderStatus.activation_pending, OrderStatus.completed,
}


# Fields editable after the order has shipped or been cancelled/refunded.
_LOCKED_ORDER_FIELDS = {
    "buyer_name", "phone", "alt_phone", "email", "address_line1", "address_line2",
    "landmark", "state", "district", "city", "pin_code", "delivery_instructions",
}


async def update_order(order_id: str, data: dict, actor: str) -> BookOrder:  # noqa: ARG001
    order = await BookOrder.get(order_id)
    if not order:
        raise NotFoundError("Order not found")
    if not data:
        raise ValidationAppError("No changes provided")

    locked = order.status in _SHIPPED_STATES or order.status in (
        OrderStatus.cancelled, OrderStatus.refunded,
    )
    blocked = [k for k in data if locked and k in _LOCKED_ORDER_FIELDS]
    if blocked:
        raise ValidationAppError(
            f"Cannot modify {', '.join(blocked)} on a {order.status.value} order"
        )

    for key, value in data.items():
        setattr(order, key, value)

    if order.delivery_type == "home" and not locked:
        if order.address_line1 and not order.pin_code:
            raise ValidationAppError("Home delivery requires a PIN code when an address is set")

    order.touch()
    await order.save()
    return order


async def update_status(order_id: str, status: OrderStatus, actor: str,
                        note: str | None = None) -> BookOrder:
    order = await BookOrder.get(order_id)
    if not order:
        raise NotFoundError("Order not found")
    if status not in _ADMIN_TRANSITIONS:
        raise ValidationAppError("Not an allowed manual order transition")

    # Shipping decrements physical stock from the reserved pool once.
    if status == OrderStatus.shipped and order.product_id and \
            order.status not in _SHIPPED_STATES:
        await adjust_inventory(order.product_id, "ship", 1, actor=actor,
                               reason="order shipped", order_id=order_id)
        order.dispatched_at = utcnow()
    if status == OrderStatus.delivered:
        order.delivered_at = utcnow()
        # Book delivered -> membership activation becomes possible.
        _push_status(order, OrderStatus.delivered, note, actor)
        _push_status(order, OrderStatus.activation_pending,
                     "Book delivered — activate membership")
        await order.save()
        _notify_order(order, "Book Delivered",
                      f"Your SpeakEdge book ({order.order_number}) has been delivered. "
                      "Activate your membership with the code inside the book.")
        return order

    _push_status(order, status, note, actor)
    await order.save()
    return order


async def assign_tracking(order_id: str, courier_name: str, tracking_number: str,
                          tracking_url: str | None, actor: str) -> BookOrder:
    order = await BookOrder.get(order_id)
    if not order:
        raise NotFoundError("Order not found")
    order.courier_name = courier_name
    order.tracking_number = tracking_number
    order.tracking_url = tracking_url
    if order.status in (OrderStatus.ready_for_dispatch, OrderStatus.packed,
                        OrderStatus.confirmed, OrderStatus.inventory_reserved):
        _push_status(order, OrderStatus.shipment_created, f"{courier_name} {tracking_number}", actor)
    await order.save()
    _notify_order(order, "Shipment Created",
                  f"Your order {order.order_number} is booked with {courier_name}. "
                  f"Tracking: {tracking_number}.")
    return order


# --------------------------------------------------------------------------
# Office pickup — OTP + QR token
# --------------------------------------------------------------------------
def _issue_pickup(order: BookOrder) -> None:
    order.pickup_otp = f"{secrets.randbelow(1_000_000):06d}"
    order.pickup_token = uuid.uuid4().hex
    order.pickup_expires_at = utcnow() + timedelta(days=settings.PICKUP_EXPIRY_DAYS)


def pickup_qr_payload(order: BookOrder) -> str | None:
    if not order.pickup_token:
        return None
    return f"SPKPICKUP:{order.order_number}:{order.pickup_token}"


async def verify_pickup(order_number: str, *, otp: str | None = None,
                        token: str | None = None, actor: str) -> BookOrder:
    order = await BookOrder.find_one(BookOrder.order_number == order_number)
    if not order:
        raise NotFoundError("Order not found")
    if order.delivery_type != "office":
        raise ValidationAppError("This order is not an office-collection order")
    if order.status == OrderStatus.collected:
        raise ConflictError("This order has already been collected")
    expires = _as_utc(order.pickup_expires_at)
    if expires and expires < utcnow():
        raise ConflictError("Pickup token has expired; please contact support")
    ok_otp = otp is not None and order.pickup_otp and secrets.compare_digest(otp, order.pickup_otp)
    ok_token = token is not None and order.pickup_token and \
        secrets.compare_digest(token, order.pickup_token)
    if not (ok_otp or ok_token):
        raise ValidationAppError("Invalid pickup OTP or token")

    if order.product_id:
        await adjust_inventory(order.product_id, "ship", 1, actor=actor,
                               reason="office collection", order_id=str(order.id))
    order.delivered_at = utcnow()
    _push_status(order, OrderStatus.collected, "Verified at office", actor)
    _push_status(order, OrderStatus.activation_pending, "Collected — activate membership")
    await order.save()
    _notify_order(order, "Book Collected",
                  f"Order {order.order_number} collected. Activate your membership "
                  "with the code inside the book.")
    return order


# --------------------------------------------------------------------------
# Cancellation / refund / activation-code release
# --------------------------------------------------------------------------
async def cancel_order(order_id: str, actor: str, reason: str,
                       *, refund: bool = False) -> BookOrder:
    order = await BookOrder.get(order_id)
    if not order:
        raise NotFoundError("Order not found")
    if order.status in _SHIPPED_STATES:
        raise ConflictError("Order has already shipped and cannot be cancelled")

    # Release any reserved stock and activation code.
    if order.product_id and order.status in (OrderStatus.inventory_reserved,
                                             OrderStatus.ready_for_dispatch,
                                             OrderStatus.pickup_ready, OrderStatus.packed):
        await adjust_inventory(order.product_id, "release", 1, actor=actor,
                               reason="order cancelled", order_id=order_id)
    if order.activation_code:
        code = await ActivationCode.find_one(ActivationCode.code == order.activation_code)
        if code and code.status == CodeStatus.reserved:
            code.status = CodeStatus.unused
            code.activated_student_id = None
            code.plan = None
            code.plan_months = None
            await code.save()
        order.activation_code = None

    if refund and order.payment_id:
        payment = await Payment.get(order.payment_id)
        if payment:
            payment.status = PaymentStatus.refunded
            payment.refund_status = RefundStatus.refunded
            await payment.save()
        order.refund_status = RefundStatus.refunded
        _push_status(order, OrderStatus.refunded, reason, actor)
    else:
        _push_status(order, OrderStatus.cancelled, reason, actor)
    await order.save()
    _notify_order(order, "Order Cancelled",
                  f"Your order {order.order_number} has been cancelled. {reason}")
    return order


def _notify_order(order: BookOrder, title: str, message: str) -> None:
    messaging.send_sms(order.phone, message)
    messaging.send_whatsapp(order.alt_phone or order.phone, message)
