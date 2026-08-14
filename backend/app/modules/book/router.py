"""Book Purchase & Order Management API (Module 3 enhanced).

Public: product catalogue, checkout, order tracking by number.
Admin:  product & inventory management, order dashboard, status/shipment
        transitions, office-pickup verification, refunds, and reports."""
from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from pydantic import BaseModel, EmailStr

from app.core.envelope import ok
from app.core.exceptions import NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin
from app.core.config import settings
from app.core.ratelimit import rate_limit
from app.db.models import (
    BookOrder,
    BookProduct,
    BookVersion,
    InventoryTransaction,
    OrderStatus,
    Payment,
    PaymentStatus,
)
from app.modules.book import service
from app.shared import file_service
from app.shared.audit import log_activity

router = APIRouter(prefix="/books", tags=["book-shop"])
_limit = rate_limit("payment", settings.RATE_LIMIT_PAYMENT_PER_MIN)


# --------------------------------------------------------------------------
# Public catalogue
# --------------------------------------------------------------------------
@router.get("")
async def list_books(version: BookVersion | None = None):
    query: dict = {"status": "active", "visible": True, "is_archived": False}
    if version:
        query["version"] = version.value
    products = await BookProduct.find(query).to_list()
    return ok([
        {
            "id": str(p.id), "name": p.name, "sku": p.sku, "version": p.version.value,
            "language": p.language, "description": p.description,
            "cover_image_url": p.cover_image_url, "gallery": p.gallery,
            "price": p.price, "offer_price": p.offer_price, "sell_price": p.sell_price,
            "gst_rate": p.gst_rate, "in_stock": p.available > 0,
            "is_speakedge_book": p.is_speakedge_book,
        }
        for p in products
    ])


@router.get("/speakedge")
async def speakedge_book():
    """The one book bundled with membership — the combined checkout needs it
    without the caller having to know its id."""
    p = await service.get_speakedge_book()
    if not p:
        raise NotFoundError("The SpeakEdge Book is not available right now")
    data = p.model_dump(mode="json")
    data["available"] = p.available
    data["sell_price"] = p.sell_price
    return ok(data)


@router.get("/product/{product_id}")
async def get_book(product_id: str):
    p = await service.get_product(product_id)
    data = p.model_dump(mode="json")
    data["available"] = p.available
    data["sell_price"] = p.sell_price
    return ok(data)


# --------------------------------------------------------------------------
# Checkout + tracking (public — buyers are not members yet)
# --------------------------------------------------------------------------
class CheckoutRequest(BaseModel):
    buyer_name: str
    phone: str
    delivery_type: str = "home"  # office | home
    product_id: str | None = None
    version: BookVersion | None = None
    plan: str | None = None    # membership bundled in (SpeakEdge Book route)
    months: int | None = None  # chosen membership term
    email: EmailStr | None = None
    alt_phone: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    landmark: str | None = None
    state: str | None = None
    district: str | None = None
    city: str | None = None
    pin_code: str | None = None
    delivery_instructions: str | None = None
    # Terms & Conditions acceptance — mandatory before an order is created.
    accept_terms: bool = False


@router.post("/checkout", dependencies=[Depends(_limit)])
async def checkout(body: CheckoutRequest, request: Request):
    if not body.accept_terms:
        raise ValidationAppError(
            "Please read and accept the Terms & Conditions, Privacy Policy and "
            "Cancellation & Refund Policy before making a payment."
        )
    result = await service.create_checkout(
        buyer_name=body.buyer_name, phone=body.phone, delivery_type=body.delivery_type,
        product_id=body.product_id, version=body.version.value if body.version else None,
        plan=body.plan, months=body.months,
        email=body.email, alt_phone=body.alt_phone, address_line1=body.address_line1,
        address_line2=body.address_line2, landmark=body.landmark, state=body.state,
        district=body.district, city=body.city, pin_code=body.pin_code,
        delivery_instructions=body.delivery_instructions,
    )
    await log_activity(body.phone, "book.checkout", role="public",
                       meta={"order_number": result["order_number"], "amount": result["amount"]},
                       ip=request.client.host if request.client else None)
    return ok(result, "Order created. Complete payment to confirm.")


@router.get("/track/{order_number}")
async def track(order_number: str, phone: str | None = None):
    """Public order tracking. Phone is required to reveal buyer/address details;
    without it, only the status timeline is returned."""
    order = await BookOrder.find_one(BookOrder.order_number == order_number)
    if not order:
        raise NotFoundError("Order not found")
    timeline = {
        "order_number": order.order_number,
        "status": order.status.value,
        "delivery_type": order.delivery_type,
        "courier_name": order.courier_name,
        "tracking_number": order.tracking_number,
        "tracking_url": order.tracking_url,
        "status_history": order.status_history,
    }
    if phone and phone == order.phone:
        timeline.update({
            "buyer_name": order.buyer_name,
            "amount": order.amount,
            "plan": order.plan,
            "plan_months": order.plan_months,
            "activation_code": order.activation_code,
            "pickup_otp": order.pickup_otp if order.delivery_type == "office" else None,
            "pickup_qr": service.pickup_qr_payload(order),
        })
    return ok(timeline)


@router.get("/receipt/{order_number}")
async def receipt(order_number: str, phone: str):
    """Downloadable PDF receipt for the order-confirmation screen. Phone must
    match the order — the buyer is a guest, so there is no session to check."""
    order = await BookOrder.find_one(BookOrder.order_number == order_number)
    if not order or order.phone != phone:
        raise NotFoundError("Order not found")
    pdf = await service.build_receipt(order)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{order_number}.pdf"'},
    )


# --------------------------------------------------------------------------
# Admin — product & inventory management
# --------------------------------------------------------------------------
class ProductBody(BaseModel):
    name: str
    sku: str
    version: BookVersion = BookVersion.international
    language: str = "English"
    description: str | None = None
    cover_image_url: str | None = None
    gallery: list[str] = []
    price: int
    offer_price: int | None = None
    gst_rate: float = 0.0
    stock: int = 0
    weight_g: int | None = None
    length_mm: int | None = None
    width_mm: int | None = None
    height_mm: int | None = None
    low_stock_threshold: int = 10
    status: str = "active"
    visible: bool = True
    is_speakedge_book: bool = False


@router.post("/admin/products")
async def create_product(body: ProductBody, admin: CurrentUser = Depends(require_admin)):
    product = await service.create_product(body.model_dump())
    if product.is_speakedge_book:
        await service.clear_other_speakedge_books(str(product.id))
    await log_activity(admin.subject, "book.product_create", role=admin.role.value,
                       target_id=str(product.id), meta={"sku": product.sku})
    return ok(product.model_dump(mode="json"))


class ProductUpdate(BaseModel):
    name: str | None = None
    version: BookVersion | None = None
    language: str | None = None
    description: str | None = None
    cover_image_url: str | None = None
    gallery: list[str] | None = None
    price: int | None = None
    offer_price: int | None = None
    gst_rate: float | None = None
    weight_g: int | None = None
    low_stock_threshold: int | None = None
    status: str | None = None
    visible: bool | None = None
    is_speakedge_book: bool | None = None


@router.patch("/admin/products/{product_id}")
async def update_product(product_id: str, body: ProductUpdate,
                         admin: CurrentUser = Depends(require_admin)):
    product = await service.get_product(product_id)
    data = body.model_dump(exclude_none=True)
    if "version" in data:
        data["version"] = body.version.value
    for k, v in data.items():
        setattr(product, k, v)
    product.touch()
    await product.save()
    if data.get("is_speakedge_book"):
        await service.clear_other_speakedge_books(str(product.id))
    await log_activity(admin.subject, "book.product_update", role=admin.role.value,
                       target_id=product_id, meta={"sku": product.sku})
    return ok(product.model_dump(mode="json"))


@router.delete("/admin/products/{product_id}")
async def archive_product(product_id: str, admin: CurrentUser = Depends(require_admin)):
    product = await service.archive_product(product_id, admin.subject)
    await log_activity(admin.subject, "book.product_archive", role=admin.role.value,
                       target_id=product_id, meta={"sku": product.sku})
    return ok(message="Product deleted")


@router.get("/admin/products")
async def admin_products(admin: CurrentUser = Depends(require_admin)):
    products = await BookProduct.find(BookProduct.is_archived == False).to_list()  # noqa: E712
    out = []
    for p in products:
        d = p.model_dump(mode="json")
        d["available"] = p.available
        d["low_stock"] = p.available <= p.low_stock_threshold
        out.append(d)
    return ok(out)


@router.get("/admin/products/{product_id}")
async def admin_product_detail(product_id: str, admin: CurrentUser = Depends(require_admin)):
    product = await service.get_product(product_id)
    data = product.model_dump(mode="json")
    data["available"] = product.available
    data["low_stock"] = product.available <= product.low_stock_threshold
    data["sell_price"] = product.sell_price
    return ok(data)


@router.post("/admin/products/{product_id}/gallery")
async def upload_product_gallery(
    product_id: str,
    files: list[UploadFile] = File(...),
    admin: CurrentUser = Depends(require_admin),
):
    if not files:
        raise ValidationAppError("Upload at least one image")
    product = await service.get_product(product_id)
    uploaded: list[str] = []
    for f in files:
        if f.content_type not in file_service.ALLOWED_IMAGE_TYPES:
            raise ValidationAppError("Images must be JPEG, PNG, or WebP")
        uploaded.append(file_service.save_book_cover(await f.read()))
    product.gallery = list(product.gallery) + uploaded
    if not product.cover_image_url and uploaded:
        product.cover_image_url = uploaded[0]
    product.touch()
    await product.save()
    await log_activity(admin.subject, "book.gallery_upload", role=admin.role.value,
                       target_id=product_id, meta={"added": len(uploaded)})
    data = product.model_dump(mode="json")
    data["available"] = product.available
    data["low_stock"] = product.available <= product.low_stock_threshold
    data["sell_price"] = product.sell_price
    return ok(data, f"Added {len(uploaded)} image(s)")


class InventoryBody(BaseModel):
    kind: str = "restock"  # restock | adjust
    qty: int
    reason: str | None = None


@router.post("/admin/products/{product_id}/inventory")
async def adjust_inventory(product_id: str, body: InventoryBody,
                           admin: CurrentUser = Depends(require_admin)):
    if body.kind not in ("restock", "adjust"):
        raise ValidationAppError("kind must be 'restock' or 'adjust'")
    product = await service.adjust_inventory(product_id, body.kind, body.qty,
                                             actor=admin.subject, reason=body.reason)
    await log_activity(admin.subject, "book.inventory", role=admin.role.value,
                       target_id=product_id, meta={"kind": body.kind, "qty": body.qty})
    return ok({"stock": product.stock, "reserved": product.reserved,
               "available": product.available})


@router.get("/admin/products/{product_id}/inventory-log")
async def inventory_log(product_id: str, admin: CurrentUser = Depends(require_admin)):
    items = await InventoryTransaction.find(
        InventoryTransaction.product_id == product_id
    ).sort(-InventoryTransaction.created_at).limit(200).to_list()
    return ok([i.model_dump(mode="json") for i in items])


# --------------------------------------------------------------------------
# Admin — order dashboard
# --------------------------------------------------------------------------
@router.get("/admin/orders")
async def admin_orders(
    admin: CurrentUser = Depends(require_admin),
    status: OrderStatus | None = None,
    delivery_type: str | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status.value
    if delivery_type:
        query["delivery_type"] = delivery_type
    if q:
        query["$or"] = [
            {"order_number": {"$regex": q, "$options": "i"}},
            {"buyer_name": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"tracking_number": {"$regex": q, "$options": "i"}},
            {"activation_code": {"$regex": q, "$options": "i"}},
        ]
    total = await BookOrder.find(query).count()
    items = (
        await BookOrder.find(query).sort(-BookOrder.created_at)
        .skip((page - 1) * page_size).limit(page_size).to_list()
    )
    return ok({"items": [o.model_dump(mode="json") for o in items], "total": total,
               "page": page, "page_size": page_size})


@router.get("/admin/orders/{order_id}")
async def admin_order_detail(order_id: str, admin: CurrentUser = Depends(require_admin)):
    order = await BookOrder.get(order_id)
    if not order:
        raise NotFoundError("Order not found")
    data = order.model_dump(mode="json")
    if order.payment_id:
        payment = await Payment.get(order.payment_id)
        data["payment"] = payment.model_dump(mode="json") if payment else None
    data["pickup_qr"] = service.pickup_qr_payload(order)
    return ok(data)


class OrderUpdate(BaseModel):
    buyer_name: str | None = None
    phone: str | None = None
    alt_phone: str | None = None
    email: EmailStr | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    landmark: str | None = None
    state: str | None = None
    district: str | None = None
    city: str | None = None
    pin_code: str | None = None
    delivery_instructions: str | None = None
    internal_notes: str | None = None


@router.patch("/admin/orders/{order_id}")
async def update_order(order_id: str, body: OrderUpdate,
                       admin: CurrentUser = Depends(require_admin)):
    order = await service.update_order(order_id, body.model_dump(exclude_none=True), admin.subject)
    await log_activity(admin.subject, "book.order_update", role=admin.role.value, target_id=order_id)
    data = order.model_dump(mode="json")
    if order.payment_id:
        payment = await Payment.get(order.payment_id)
        data["payment"] = payment.model_dump(mode="json") if payment else None
    data["pickup_qr"] = service.pickup_qr_payload(order)
    return ok(data)


class StatusBody(BaseModel):
    status: OrderStatus
    note: str | None = None


@router.post("/admin/orders/{order_id}/status")
async def set_order_status(order_id: str, body: StatusBody,
                           admin: CurrentUser = Depends(require_admin)):
    order = await service.update_status(order_id, body.status, admin.subject, body.note)
    await log_activity(admin.subject, "book.status", role=admin.role.value,
                       target_id=order_id, meta={"status": body.status.value})
    return ok(order.model_dump(mode="json"))


class TrackingBody(BaseModel):
    courier_name: str
    tracking_number: str
    tracking_url: str | None = None


@router.post("/admin/orders/{order_id}/tracking")
async def set_tracking(order_id: str, body: TrackingBody,
                       admin: CurrentUser = Depends(require_admin)):
    order = await service.assign_tracking(order_id, body.courier_name, body.tracking_number,
                                          body.tracking_url, admin.subject)
    await log_activity(admin.subject, "book.tracking", role=admin.role.value,
                       target_id=order_id, meta={"courier": body.courier_name})
    return ok(order.model_dump(mode="json"))


class CancelBody(BaseModel):
    reason: str
    refund: bool = False


@router.post("/admin/orders/{order_id}/cancel")
async def cancel_order(order_id: str, body: CancelBody,
                       admin: CurrentUser = Depends(require_admin)):
    order = await service.cancel_order(order_id, admin.subject, body.reason, refund=body.refund)
    await log_activity(admin.subject, "book.cancel", role=admin.role.value,
                       target_id=order_id, meta={"refund": body.refund})
    return ok(order.model_dump(mode="json"))


# --------------------------------------------------------------------------
# Admin — office pickup verification
# --------------------------------------------------------------------------
class PickupVerify(BaseModel):
    order_number: str
    otp: str | None = None
    token: str | None = None


@router.post("/admin/pickup/verify")
async def pickup_verify(body: PickupVerify, admin: CurrentUser = Depends(require_admin)):
    order = await service.verify_pickup(body.order_number, otp=body.otp,
                                        token=body.token, actor=admin.subject)
    await log_activity(admin.subject, "book.pickup_verify", role=admin.role.value,
                       target_id=order.order_number)
    return ok(order.model_dump(mode="json"), "Pickup verified — order collected")


@router.get("/admin/pickup/ready")
async def pickup_ready(admin: CurrentUser = Depends(require_admin)):
    orders = await BookOrder.find(
        BookOrder.delivery_type == "office",
        BookOrder.status == OrderStatus.pickup_ready,
        BookOrder.is_archived == False,  # noqa: E712
    ).to_list()
    return ok([o.model_dump(mode="json") for o in orders])


# --------------------------------------------------------------------------
# Admin — reports
# --------------------------------------------------------------------------
@router.get("/admin/reports")
async def reports(admin: CurrentUser = Depends(require_admin)):
    orders = await BookOrder.find(BookOrder.is_archived == False).to_list()  # noqa: E712
    paid_statuses = {PaymentStatus.paid.value, PaymentStatus.manually_approved.value}
    by_status: dict = {}
    by_state: dict = {}
    delivered = 0
    for o in orders:
        by_status[o.status.value] = by_status.get(o.status.value, 0) + 1
        if o.state:
            by_state[o.state] = by_state.get(o.state, 0) + 1
        if o.status in (OrderStatus.delivered, OrderStatus.collected,
                        OrderStatus.activation_pending, OrderStatus.completed):
            delivered += 1
    book_revenue = await Payment.find(
        {"kind": "book", "status": {"$in": list(paid_statuses)}}
    ).sum(Payment.amount) or 0

    products = await BookProduct.find(BookProduct.is_archived == False).to_list()  # noqa: E712
    inventory = [
        {"sku": p.sku, "name": p.name, "stock": p.stock, "reserved": p.reserved,
         "available": p.available, "low_stock": p.available <= p.low_stock_threshold}
        for p in products
    ]
    from app.db.models import ActivationCode, CodeStatus
    codes_reserved = await ActivationCode.find(ActivationCode.status == CodeStatus.reserved).count()

    total = len(orders)
    return ok({
        "orders": {"total": total, "delivered": delivered,
                   "avg_order_value_paise": int(book_revenue / total) if total else 0},
        "revenue_paise": int(book_revenue),
        "by_status": by_status,
        "by_state": by_state,
        "inventory": inventory,
        "activation_codes_reserved": codes_reserved,
    })
