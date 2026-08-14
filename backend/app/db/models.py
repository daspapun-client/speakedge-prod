"""All MongoDB document models (Beanie). Extends the audited base so every
collection inherits the soft-delete/archive lifecycle. Indexes are declared
per-model and created at startup by init_db()."""
from datetime import datetime
from enum import Enum
from typing import ClassVar, Optional

import pymongo
from beanie import Document, Indexed
from pydantic import EmailStr, Field

from app.core.security import Role
from app.db.base import AuditedDocument, utcnow


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class CodeStatus(str, Enum):
    unused = "unused"
    reserved = "reserved"  # allocated to a paid book order awaiting delivery
    activated = "activated"
    blocked = "blocked"


class MembershipStatus(str, Enum):
    pending = "Pending Verification"
    active = "Active"
    rejected = "Rejected"
    suspended = "Suspended"


class CEFRStatus(str, Enum):
    self_declared = "Self-Declared – Not Verified"
    verified = "Verified"


class PaymentStatus(str, Enum):
    created = "created"            # Pending
    paid = "paid"                  # Success
    failed = "failed"
    manually_approved = "manually_approved"
    refunded = "refunded"
    partially_refunded = "partially_refunded"
    cancelled = "cancelled"


class RefundStatus(str, Enum):
    requested = "Refund Requested"
    under_review = "Refund Under Review"
    approved = "Refund Approved"
    rejected = "Refund Rejected"
    refunded = "Refunded"
    partially_refunded = "Partially Refunded"


class PromptAudience(str, Enum):
    adults = "adults"
    kids = "kids"


class EnglishStyle(str, Enum):
    """Student's preferred English. Drives accent-specific prompt slots and the
    tone the AI tutor keeps throughout a session."""
    british = "British English"
    american = "American English"
    international = "Neutral International English"


# Accent key used by prompt slots / target-expression maps.
ENGLISH_STYLE_KEY = {
    EnglishStyle.british: "british",
    EnglishStyle.american: "american",
    EnglishStyle.international: "international",
}

CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]


class SubscriptionPlan(str, Enum):
    # Membership tiers (A2–C1 learners). "Pro" variants add a second teacher
    # class/week. Tribe & Basic are one-time only (no monthly fee).
    tribe = "Tribe"
    basic = "Basic"
    silver = "Silver"
    silver_pro = "Silver Pro"
    gold = "Gold"
    gold_pro = "Gold Pro"
    diamond = "Diamond"
    diamond_pro = "Diamond Pro"
    # Separate offering for A1–A2 learners (discounted for members).
    basic_english = "Basic English Course"


# ---------------------------------------------------------------------------
# Auth / identity
# ---------------------------------------------------------------------------
class User(AuditedDocument):
    """Login identity. Students also get a User row (username = student_id)."""
    email: Optional[EmailStr] = None
    username: Indexed(str, unique=True)  # type: ignore
    password_hash: str
    role: Role = Role.student
    full_name: Optional[str] = None
    is_active: bool = True
    student_id: Optional[str] = None  # link to Student when role == student
    last_login_at: Optional[datetime] = None

    class Settings:
        name = "users"
        indexes = [
            [("role", pymongo.ASCENDING)],
            [("student_id", pymongo.ASCENDING)],
        ]


class ActivationCode(AuditedDocument):
    code: Indexed(str, unique=True)  # type: ignore  # e.g. SPK-26-Z62AbH -> becomes Student ID
    status: CodeStatus = CodeStatus.unused
    batch_id: Optional[str] = None
    # Course type the code was issued for. Kids and Adults are separate courses:
    # this is stamped by admin at generation and becomes Student.audience at
    # activation, which is what gates the whole prompt library / AI engine.
    audience: PromptAudience = PromptAudience.adults
    activated_at: Optional[datetime] = None
    activated_student_id: Optional[str] = None
    blocked_reason: Optional[str] = None
    # Membership paid for alongside the book. Stamped when the order is paid;
    # activation turns it into the student's first Subscription.
    plan: Optional[str] = None
    plan_months: Optional[int] = None

    class Settings:
        name = "activation_codes"
        indexes = [
            [("status", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)],
            [("batch_id", pymongo.ASCENDING)],
        ]


class Student(AuditedDocument):
    """Permanent identity keyed by the activation code (student_id == code)."""
    student_id: Indexed(str, unique=True)  # type: ignore
    full_name: str
    age: Optional[int] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    dob: Optional[str] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    state: Optional[str] = None
    district: Optional[str] = None
    pin_code: Optional[str] = None
    about_me: Optional[str] = None
    photo_url: Optional[str] = None
    id_proof_url: Optional[str] = None
    id_proof_type: Optional[str] = None    # one of ID_PROOF_TYPES (see membership/router.py)
    id_proof_number: Optional[str] = None  # as printed on the document (optional)
    referral_code: Optional[str] = None
    membership_status: MembershipStatus = MembershipStatus.pending
    cefr_status: CEFRStatus = CEFRStatus.self_declared
    cefr_level: Optional[str] = None
    # Consent & agreements (all five must be accepted at activation)
    consent_community_rules: bool = False
    consent_terms: bool = False
    consent_safety_policy: bool = False
    consent_non_refund: bool = False
    consent_process: bool = False
    verified_at: Optional[datetime] = None
    verified_by: Optional[str] = None
    reject_reason: Optional[str] = None
    # New-student orientation (Module: Orientation). Gates the "Start Orientation"
    # prompt on the dashboard; completion is set by a teacher/admin or self-serve.
    orientation_status: str = "pending"  # pending | in_progress | completed
    orientation_batch_id: Optional[str] = None
    orientation_step: int = 0  # furthest walkthrough step the student has reached
    orientation_completed_at: Optional[datetime] = None
    orientation_completed_by: Optional[str] = None  # "self" | teacher/admin actor
    # --- Learning preferences (feed the AI prompt engine; no manual prompt edits) ---
    # cefr_level above is the CEFR dimension. These add the other two.
    preferred_english: EnglishStyle = EnglishStyle.international
    preferred_language: str = "en"  # mother tongue / UI language for instructions & explanations
    # Inherited from the activation code and only changeable by an admin — a
    # student must not be able to switch course and read the other library.
    audience: PromptAudience = PromptAudience.adults
    # Position in the 48-week × 6-day journey (1-based).
    learning_week: int = 1
    learning_day: int = 1
    # --- Admin access locks (independent of membership/subscription status) ---
    # Set from Admin → Users. A lock leaves the account otherwise usable.
    teacher_class_locked: bool = False   # cannot join/see teacher-led batches
    community_locked: bool = False       # cannot use the community (directory, DMs, teams)
    access_lock_reason: Optional[str] = None

    class Settings:
        name = "students"
        indexes = [
            [("membership_status", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)],
            [("cefr_level", pymongo.ASCENDING), ("gender", pymongo.ASCENDING)],
            [("full_name", pymongo.TEXT), ("email", pymongo.TEXT)],
        ]


# ---------------------------------------------------------------------------
# Community
# ---------------------------------------------------------------------------
class CommunityProfile(AuditedDocument):
    student_id: Indexed(str, unique=True)  # type: ignore
    display_name: str
    first_name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    photo_url: Optional[str] = None
    cefr_status: CEFRStatus = CEFRStatus.self_declared
    cefr_level: Optional[str] = None
    bio: Optional[str] = None
    interests: list[str] = Field(default_factory=list)  # communication interests
    looking_for_partner: bool = False
    is_suspended: bool = False

    class Settings:
        name = "community_profiles"
        indexes = [[("cefr_level", pymongo.ASCENDING)], [("looking_for_partner", pymongo.ASCENDING)]]


class FriendRequest(AuditedDocument):
    from_student_id: str
    to_student_id: str
    status: str = "pending"  # pending | accepted | declined

    class Settings:
        name = "friend_requests"
        indexes = [
            [("to_student_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)],
            [("from_student_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)],
        ]


class Block(AuditedDocument):
    """One member blocking another (directional, Facebook-style). Independent of
    FriendRequest — you can block someone who never sent you a request."""
    blocker_student_id: str
    blocked_student_id: str

    class Settings:
        name = "blocks"
        indexes = [[("blocker_student_id", pymongo.ASCENDING), ("blocked_student_id", pymongo.ASCENDING)]]


class DirectMessage(AuditedDocument):
    """1:1 chat message between two friends. conversation_key is the deterministic
    sorted pair "a|b" so both directions share one thread."""
    conversation_key: str
    from_student_id: str
    to_student_id: str
    text: str
    is_read: bool = False
    reply_to_id: str | None = None
    reply_to_sender_name: str | None = None
    reply_to_text: str | None = None
    reactions: dict[str, list[str]] = Field(default_factory=dict)

    class Settings:
        name = "direct_messages"
        indexes = [
            [("conversation_key", pymongo.ASCENDING), ("created_at", pymongo.ASCENDING)],
            [("to_student_id", pymongo.ASCENDING), ("is_read", pymongo.ASCENDING)],
        ]


class SpeakingTeam(AuditedDocument):
    name: str
    owner_student_id: str
    member_ids: list[str] = Field(default_factory=list)
    description: Optional[str] = None
    max_members: int = 8
    banner_url: Optional[str] = None
    is_suspended: bool = False
    class_day: Optional[str] = None   # weekday name, lowercase ("sunday"), IST — matches Batch.day_of_week
    class_time: Optional[str] = None  # "HH:MM" IST

    MAX_TEAMS_PER_OWNER: ClassVar[int] = 2
    MAX_MEMBERS: ClassVar[int] = 8

    class Settings:
        name = "speaking_teams"


class TeamMessage(AuditedDocument):
    team_id: str
    sender_student_id: str
    sender_name: str
    text: str
    reply_to_id: str | None = None
    reply_to_sender_name: str | None = None
    reply_to_text: str | None = None
    reactions: dict[str, list[str]] = Field(default_factory=dict)

    class Settings:
        name = "team_messages"
        indexes = [[("team_id", pymongo.ASCENDING), ("created_at", pymongo.ASCENDING)]]


class TeamRead(Document):
    """Per-member read pointer for a community chat (drives read receipts).
    Not archived — it is a tiny mutable pointer, one row per (team, member)."""
    team_id: str
    student_id: str
    last_read_message_id: str
    updated_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "team_reads"
        indexes = [[("team_id", pymongo.ASCENDING), ("student_id", pymongo.ASCENDING)]]


class TeamJoinRequest(AuditedDocument):
    team_id: str
    requester_student_id: str
    requester_name: str
    status: str = "pending"  # pending | approved | declined

    class Settings:
        name = "team_join_requests"
        indexes = [[("team_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)]]


class SafetyCard(AuditedDocument):
    student_id: str
    card_type: str  # yellow | deep_yellow | red | suspension | termination
    reason: str
    issued_by: str

    class Settings:
        name = "safety_cards"
        indexes = [[("student_id", pymongo.ASCENDING)]]


class CommunityReport(AuditedDocument):
    """Member-submitted report against another member (Report & Block system)."""
    reporter_student_id: str
    against_student_id: str
    reason: str
    status: str = "open"  # open | reviewed | action_taken | dismissed
    reviewed_by: Optional[str] = None

    class Settings:
        name = "community_reports"
        indexes = [[("against_student_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)]]


class ClassAttendance(AuditedDocument):
    """One student's RSVP + post-class attendance/rating for a single community
    class occurrence (identified by team_id + session_date). Created on RSVP;
    `attended`/`rating` filled by the mandatory post-class popup 24h later."""
    team_id: str
    session_date: str            # "YYYY-MM-DD" IST date of the class occurrence
    student_id: str
    student_name: str
    attended: Optional[bool] = None   # None until the student answers the popup
    rating: Optional[int] = None      # 1-5, set when attended
    responded_at: Optional[datetime] = None

    class Settings:
        name = "class_attendance"
        indexes = [
            [("team_id", pymongo.ASCENDING), ("session_date", pymongo.ASCENDING)],
            [("student_id", pymongo.ASCENDING), ("attended", pymongo.ASCENDING)],
        ]


# ---------------------------------------------------------------------------
# Payments / subscription
# ---------------------------------------------------------------------------
class Payment(AuditedDocument):
    student_id: str
    kind: str = "subscription"  # subscription | book | exam | monthly
    plan: Optional[str] = None
    months: Optional[int] = None  # chosen subscription duration (months) for this order
    due_month: Optional[str] = None  # "YYYY-MM" — which monthly fee this settles (kind="monthly")
    amount: int  # in paise
    currency: str = "INR"
    status: PaymentStatus = PaymentStatus.created
    payment_mode: Optional[str] = None  # razorpay | cash | bank_transfer | upi_manual ...
    transaction_ref: Optional[str] = None  # manual approval reference
    remarks: Optional[str] = None
    razorpay_order_id: Optional[str] = None
    razorpay_payment_id: Optional[str] = None
    razorpay_signature: Optional[str] = None
    invoice_no: Optional[str] = None
    invoice_url: Optional[str] = None
    failure_reason: Optional[str] = None
    # Terms & Conditions acceptance captured at checkout, before the order is
    # created. Stored as evidence of what the buyer agreed to.
    terms_accepted_at: Optional[datetime] = None
    terms_version: Optional[str] = None
    refund_id: Optional[str] = None
    refund_status: Optional[RefundStatus] = None
    # GST-ready architecture (not mandatory in v1)
    gst_number: Optional[str] = None
    taxable_amount: Optional[int] = None
    cgst: Optional[int] = None
    sgst: Optional[int] = None
    igst: Optional[int] = None
    total_tax: Optional[int] = None
    gst_invoice_no: Optional[str] = None

    class Settings:
        name = "payments"
        indexes = [
            [("student_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)],
            [("razorpay_order_id", pymongo.ASCENDING)],
        ]


class PlanConfig(AuditedDocument):
    """Admin-editable subscription plan catalogue (Module 11: admin can edit
    plan details, pricing, benefits). Nothing is hard-coded — spec values are
    only seeded on a fresh DB; the admin owns the catalogue thereafter.

    Pricing model: `amount` is the one-time admission/membership fee (paise) —
    that is what checkout charges. `monthly_fee` is the recurring monthly fee
    (0 = one-time-only plan, e.g. Tribe/Basic); it is quoted on the plan card
    and collected separately, never bundled into the upfront charge."""
    plan: Indexed(str, unique=True)  # type: ignore  # SubscriptionPlan value
    label: str
    amount: int  # paise — one-time admission / membership fee (charged upfront)
    offer_price: Optional[int] = None  # paise; discounted admission (wins over amount)
    monthly_fee: int = 0      # paise — recurring monthly fee, billed separately
    # Optional per-term price override (month count as a string → paise). Empty
    # by default: checkout then charges the admission fee alone.
    prices: dict[str, int] = Field(default_factory=dict)
    duration_days: int        # fallback validity when a month count isn't given
    durations: list[int] = Field(default_factory=lambda: [3, 6, 12])  # months offered
    classes_per_week: int = 1        # teacher-led classes / week
    conversation_per_week: int = 0   # conversation teams available
    community_years: int = 1         # community access duration (years)
    support_years: int = 0           # student relation support (years)
    total_classes: int = 0
    cefr_tests: int = 1       # total CEFR test eligibility for this tier
    speaking_tests: int = 1   # total Speaking test eligibility for this tier
    enabled: bool = True
    # Bumped when the spec catalogue changes; older rows are refreshed once.
    spec_version: int = 0

    class Settings:
        name = "plan_configs"


class Subscription(AuditedDocument):
    student_id: Indexed(str)  # type: ignore
    plan: str  # PlanConfig.plan key (free-form so admin can add custom plans)
    started_at: datetime
    expires_at: datetime
    # Anchor for the monthly-fee schedule: the student's first teacher-led class
    # date. Admin sets it (auto-suggested from the first batch the student is
    # enrolled in); until it is set the schedule falls back to started_at.
    billing_start_at: Optional[datetime] = None
    is_active: bool = True
    months: Optional[int] = None  # duration purchased (months)
    cefr_tests: int = 1       # exam eligibility granted by this plan tier
    speaking_tests: int = 1
    payment_id: Optional[str] = None
    expiry_reminded: bool = False  # set once the 1-month expiry reminder is sent
    # "YYYY-MM" keys whose monthly-fee reminder has already been sent (dedup).
    monthly_reminders_sent: list[str] = Field(default_factory=list)

    class Settings:
        name = "subscriptions"
        indexes = [[("student_id", pymongo.ASCENDING), ("is_active", pymongo.ASCENDING)]]


class BookVersion(str, Enum):
    british = "British English"
    american = "American English"
    international = "International English"


class OrderStatus(str, Enum):
    draft = "Draft"
    payment_pending = "Payment Pending"
    payment_success = "Payment Success"
    confirmed = "Order Confirmed"
    inventory_reserved = "Inventory Reserved"
    ready_for_dispatch = "Ready for Dispatch"
    packed = "Packed"
    shipment_created = "Shipment Created"
    shipped = "Shipped"
    in_transit = "In Transit"
    out_for_delivery = "Out for Delivery"
    delivered = "Delivered"
    pickup_ready = "Ready for Pickup"
    collected = "Collected"
    activation_pending = "Membership Activation Pending"
    completed = "Completed"
    cancelled = "Cancelled"
    refunded = "Refunded"


class BookProduct(AuditedDocument):
    """Sellable book product/variant (Module 3 enhanced: product management)."""
    name: str
    sku: Indexed(str, unique=True)  # type: ignore
    version: BookVersion = BookVersion.international
    language: str = "English"
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    gallery: list[str] = Field(default_factory=list)
    price: int              # MRP in paise
    offer_price: Optional[int] = None  # selling price in paise (defaults to price)
    gst_rate: float = 0.0   # percent; GST-ready but not mandatory in v1
    stock: int = 0          # physical units on hand
    reserved: int = 0       # units reserved by paid, undispatched orders
    weight_g: Optional[int] = None
    length_mm: Optional[int] = None
    width_mm: Optional[int] = None
    height_mm: Optional[int] = None
    low_stock_threshold: int = 10
    status: str = "active"  # active | inactive
    visible: bool = True
    # The one product tied to the membership journey: buying it always routes
    # through "Choose Your Membership" first. At most one product carries this.
    is_speakedge_book: bool = False

    @property
    def available(self) -> int:
        return max(0, self.stock - self.reserved)

    @property
    def sell_price(self) -> int:
        return self.offer_price if self.offer_price is not None else self.price

    class Settings:
        name = "book_products"
        indexes = [[("status", pymongo.ASCENDING)], [("visible", pymongo.ASCENDING)]]


class InventoryTransaction(AuditedDocument):
    """Immutable inventory movement log (restock/reserve/release/ship/adjust)."""
    product_id: str
    change: int             # +restock, -ship; reserve/release affect reserved pool
    kind: str               # restock | reserve | release | ship | adjust
    reason: Optional[str] = None
    order_id: Optional[str] = None
    stock_after: int = 0
    reserved_after: int = 0
    actor: Optional[str] = None

    class Settings:
        name = "inventory_transactions"
        indexes = [[("product_id", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)]]


class BookOrder(AuditedDocument):
    order_number: Indexed(str, unique=True)  # type: ignore
    student_id: Optional[str] = None
    product_id: Optional[str] = None
    version: Optional[BookVersion] = None
    # Buyer / contact
    buyer_name: str
    phone: str
    alt_phone: Optional[str] = None
    email: Optional[EmailStr] = None
    # Delivery
    delivery_type: str = "home"  # office | home (Speed Post)
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    landmark: Optional[str] = None
    state: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    pin_code: Optional[str] = None
    delivery_instructions: Optional[str] = None
    # Membership bundled into this order (SpeakEdge Book route). The plan is
    # paid for here but only becomes a Subscription when the buyer activates
    # their membership — it rides along on the reserved activation code.
    plan: Optional[str] = None          # SubscriptionPlan value
    plan_months: Optional[int] = None   # chosen term
    plan_amount: int = 0                # paise charged for the membership
    # Money (paise)
    book_amount: int = 0
    delivery_charge: int = 0
    gst_amount: int = 0
    amount: int = 0  # grand total
    # Lifecycle
    status: OrderStatus = OrderStatus.draft
    status_history: list[dict] = Field(default_factory=list)
    payment_id: Optional[str] = None
    # Fulfilment
    activation_code: Optional[str] = None  # reserved code that ships in the book
    courier_name: Optional[str] = None
    tracking_number: Optional[str] = None
    tracking_url: Optional[str] = None
    dispatched_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    # Office pickup
    pickup_otp: Optional[str] = None
    pickup_token: Optional[str] = None
    pickup_expires_at: Optional[datetime] = None
    # Post-sale
    refund_status: Optional[RefundStatus] = None
    replacement_status: Optional[str] = None  # requested | approved | delivered
    internal_notes: Optional[str] = None

    class Settings:
        name = "book_orders"
        indexes = [
            [("status", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)],
            [("order_number", pymongo.ASCENDING)],
            [("phone", pymongo.ASCENDING)],
        ]


# ---------------------------------------------------------------------------
# Teacher / Partner
# ---------------------------------------------------------------------------
class Teacher(AuditedDocument):
    teacher_id: Optional[str] = None  # generated on approval, e.g. TCH-26-XXXX
    name: str
    email: EmailStr
    phone: str
    whatsapp: Optional[str] = None
    city: Optional[str] = None
    qualification: Optional[str] = None
    cefr_level: Optional[str] = None  # A1..C2 | Not Tested
    experience: Optional[str] = None  # self-described teaching experience
    photo_url: Optional[str] = None
    status: str = "applied"  # applied | approved | rejected
    certified: bool = False
    public_visible: bool = True  # show in Certified Teacher Directory
    bio: Optional[str] = None
    student_id: Optional[str] = None
    username: Optional[str] = None  # linked login (User.username) for dashboard access

    class Settings:
        name = "teachers"
        indexes = [[("status", pymongo.ASCENDING)], [("teacher_id", pymongo.ASCENDING)]]


class BatchSeries(AuditedDocument):
    """Parent of a course: identity + the window used to generate sub-batches.
    Carries no live teacher or roster — each generated Batch (one per class date)
    is fully independent. The sub-batch id is the batch id for every student /
    teacher action and all analytics."""
    title: str  # course / batch name
    frequency: str  # daily | weekly | monthly (how sub-batches were generated)
    start_date: str  # "YYYY-MM-DD"
    end_date: str    # "YYYY-MM-DD"
    schedule: Optional[str] = None  # freeform note

    class Settings:
        name = "batch_series"


class Batch(AuditedDocument):
    series_id: Optional[str] = None  # parent BatchSeries id; one Batch per class date
    teacher_id: str
    title: str  # course name
    day_of_week: Optional[str] = None  # weekday name, e.g. "Monday" (recurring; gates meet link)
    date: Optional[str] = None  # "YYYY-MM-DD" — legacy single-date batch; prefer class_dates for multi-class schedules
    class_dates: list[str] = Field(default_factory=list)  # every scheduled class date "YYYY-MM-DD" under one batch name
    class_time: Optional[str] = None   # freeform display, e.g. "7:00 PM"
    slot_start: Optional[str] = None   # "HH:MM" 24h — meet link enabled from here
    slot_end: Optional[str] = None     # "HH:MM" 24h — until here
    schedule: Optional[str] = None
    meeting_url: Optional[str] = None  # Google Meet link, live only during the slot
    meeting_forced: bool = False  # teacher override — link live outside scheduled slot
    student_ids: list[str] = Field(default_factory=list)      # approved members
    pending_ids: list[str] = Field(default_factory=list)      # students awaiting join approval
    reminded_on: Optional[str] = None  # IST date "YYYY-MM-DD" a class reminder was last sent (dedup)
    attendance_reminded_on: Optional[str] = None  # IST date attendance follow-up was sent (dedup)
    teacher_cost_paise: int = 0  # per class; credited once each class date has passed
    cost_credited_dates: list[str] = Field(default_factory=list)  # class dates already turned into Remuneration
    # Attendance-confirmation workflow: class dates whose 24h-ahead confirmation
    # request has already been sent (dedup guard — a date fires exactly once).
    confirm_notified_dates: list[str] = Field(default_factory=list)

    class Settings:
        name = "batches"
        indexes = [[("series_id", pymongo.ASCENDING)]]


class OrientationBatch(AuditedDocument):
    """A scheduled New-Student Orientation session. Admin creates it, assigns a
    teacher and enrols students; the teacher (or admin) marks students complete,
    which unlocks the orientation gate on their dashboard. Recorded/self-paced
    sessions let students complete the walkthrough themselves."""
    title: str
    mode: str = "live"  # live | recorded (self-paced)
    scheduled_at: Optional[datetime] = None  # UTC start time (live sessions)
    duration_min: int = 45
    teacher_id: Optional[str] = None  # Teacher.id conducting the session
    meeting_url: Optional[str] = None  # live session join link
    recording_url: Optional[str] = None  # recorded walkthrough video (self-paced)
    agenda: list[str] = Field(default_factory=list)  # optional custom agenda lines
    student_ids: list[str] = Field(default_factory=list)  # enrolled student_ids
    status: str = "scheduled"  # scheduled | completed | cancelled
    reminded_on: Optional[str] = None  # IST date "YYYY-MM-DD" a reminder was sent (dedup)

    class Settings:
        name = "orientation_batches"
        indexes = [[("status", pymongo.ASCENDING), ("scheduled_at", pymongo.ASCENDING)]]


class BatchMessage(AuditedDocument):
    batch_id: str
    sender_id: str
    sender_name: str
    text: str

    class Settings:
        name = "batch_messages"
        indexes = [[("batch_id", pymongo.ASCENDING), ("created_at", pymongo.ASCENDING)]]


class Attendance(AuditedDocument):
    batch_id: str
    teacher_id: Optional[str] = None
    date: str
    class_time: Optional[str] = None
    present_ids: list[str] = Field(default_factory=list)
    absent_ids: list[str] = Field(default_factory=list)
    class_held: bool = True  # False when teacher reports the scheduled class did not occur
    status: str = "pending"  # pending | approved | rejected  (admin verification)
    approved: bool = False   # kept in sync with status for backwards compat
    reviewed_by: Optional[str] = None

    class Settings:
        name = "attendance"
        indexes = [[("teacher_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)]]


class Remuneration(AuditedDocument):
    teacher_id: str
    period: str  # class date or month, e.g. "2026-07" / "2026-07-02"
    attendance_id: Optional[str] = None
    amount: int  # paise
    status: str = "pending"  # pending | paid | received (teacher-confirmed)
    paid_by: Optional[str] = None
    received_confirmed_at: Optional[datetime] = None

    class Settings:
        name = "remuneration"
        indexes = [[("teacher_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)]]


class TeacherReview(AuditedDocument):
    """Auto-created review request when a class attendance is approved.
    Appears in the student dashboard once a day for 7 days until answered."""
    student_id: str
    teacher_id: str
    teacher_name: Optional[str] = None
    batch_id: Optional[str] = None
    attendance_id: Optional[str] = None
    class_date: Optional[str] = None
    class_time: Optional[str] = None
    attended: Optional[bool] = None  # student self-report via review popup
    rating: Optional[int] = None  # 1..5
    feedback: Optional[str] = None
    status: str = "pending"  # pending | submitted | missed | skipped

    class Settings:
        name = "teacher_reviews"
        indexes = [
            [("student_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)],
            [("teacher_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)],
        ]


class PartnerType(str, Enum):
    institute = "Educational Institute Partner"
    franchisee = "Complete Sujyoti Franchisee Partner"
    bookstore = "Book Store / Shop Partner"
    individual = "Individual Partner"


class Partner(AuditedDocument):
    partner_id: Optional[str] = None  # assigned on approval, e.g. PTR-26-XXXX
    partner_type: PartnerType = PartnerType.individual
    name: str  # full name / contact person
    org: Optional[str] = None  # optional for Individual & Franchisee applicants
    email: Optional[EmailStr] = None
    phone: str
    whatsapp: Optional[str] = None
    state: Optional[str] = None
    district: Optional[str] = None
    area: Optional[str] = None
    # SpeakEdge | Sujyoti Language School | Sujyoti Publications | Franchisee | All
    interested_in: list[str] = Field(default_factory=list)
    products_allowed: list[str] = Field(default_factory=list)  # set by admin on approval
    consent_contact: bool = False
    status: str = "pending"  # pending | under_review | approved | rejected | on_hold | suspended
    remarks: Optional[str] = None
    public_visible: bool = True  # public partner directory
    microsite_slug: Optional[str] = None  # franchisee microsite (franchisee partners)
    username: Optional[str] = None  # linked login for partner dashboard

    class Settings:
        name = "partners"
        indexes = [[("status", pymongo.ASCENDING)], [("microsite_slug", pymongo.ASCENDING)]]


class PartnerLead(AuditedDocument):
    partner_id: str
    name: str
    phone: str
    interest: Optional[str] = None  # product/service interest
    status: str = "new"  # new | contacted | demo_registered | admission_pending | converted | lost
    notes: Optional[str] = None

    class Settings:
        name = "partner_leads"
        indexes = [[("partner_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)]]


class PartnerReport(AuditedDocument):
    """Partner-submitted sales/admission activity. Stays Pending Admin Approval
    until approved; only approved rows count in reports."""
    partner_id: str
    report_type: str  # book_sale | course_admission | membership_sale | student_registration
    product: Optional[str] = None
    quantity: int = 1
    amount: Optional[int] = None  # paise
    remarks: Optional[str] = None
    status: str = "pending"  # pending | approved | rejected
    reviewed_by: Optional[str] = None

    class Settings:
        name = "partner_reports"
        indexes = [[("partner_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)]]


# ---------------------------------------------------------------------------
# Exams / Video
# ---------------------------------------------------------------------------
class Exam(AuditedDocument):
    kind: str = "CEFR"  # CEFR | Speaking
    title: str
    scheduled_at: Optional[datetime] = None
    examiner_id: Optional[str] = None

    class Settings:
        name = "exams"


class ExamBooking(AuditedDocument):
    exam_id: str
    student_id: str
    status: str = "booked"  # booked | completed | cancelled

    class Settings:
        name = "exam_bookings"
        indexes = [[("student_id", pymongo.ASCENDING)]]


class CEFRReport(AuditedDocument):
    student_id: str
    exam_booking_id: str
    level: str  # A1..C2
    scores: dict = Field(default_factory=dict)
    verification_code: Indexed(str, unique=True)  # type: ignore
    report_url: Optional[str] = None
    examiner_id: Optional[str] = None

    class Settings:
        name = "cefr_reports"


class Certificate(AuditedDocument):
    student_id: str
    title: str
    verification_code: Indexed(str, unique=True)  # type: ignore
    certificate_url: Optional[str] = None
    issued_at: datetime = Field(default_factory=lambda: datetime.utcnow())

    class Settings:
        name = "certificates"


class VideoCategory(AuditedDocument):
    name: Indexed(str, unique=True)  # type: ignore
    display_order: int = 0

    class Settings:
        name = "video_categories"


class Video(AuditedDocument):
    """Learning content item. Despite the collection name this now carries both
    videos and PDFs (``kind``) — the membership/plan gating below is identical
    for either, so one model serves the whole content library."""
    title: str
    kind: str = "video"  # video | pdf  (default keeps every legacy row a video)
    category: str = "general"
    source: str = "youtube"  # youtube | uploaded | pdf
    url: str
    access: str = "member"  # public | member | subscriber | admin
    plans: list[str] = Field(default_factory=list)  # PlanConfig keys; empty = all students
    student_ids: list[str] = Field(default_factory=list)  # specific students; non-empty overrides access/plans
    description: Optional[str] = None
    display_order: int = 0

    class Settings:
        name = "videos"
        indexes = [
            [("category", pymongo.ASCENDING)],
            [("access", pymongo.ASCENDING)],
            [("kind", pymongo.ASCENDING)],
        ]


class WatchHistory(AuditedDocument):
    student_id: str
    video_id: str
    watched_at: datetime = Field(default_factory=lambda: datetime.utcnow())
    last_position_s: Optional[int] = None
    completed: Optional[bool] = None
    view_count: int = 1

    class Settings:
        name = "watch_history"
        indexes = [
            [("student_id", pymongo.ASCENDING)],
            [("student_id", pymongo.ASCENDING), ("video_id", pymongo.ASCENDING)],
        ]


# ---------------------------------------------------------------------------
# Prompt Library / AI conversation
# ---------------------------------------------------------------------------
class PromptTemplate(AuditedDocument):
    """The reusable instruction body for one prompt *slot*, per audience.

    There are five slots per day (three accent-specific Lexical Integration
    variants plus Learning and Assessment), so the whole 48×6 library is driven
    by ~10 template documents instead of 2,880 copies of the same text. The
    body carries ``{{placeholders}}`` that are filled at render time from the
    student's profile (CEFR level, preferred English) and the day's lesson."""
    slot: str          # lexical_british | lexical_american | lexical_international | learning | assessment
    audience: PromptAudience = PromptAudience.adults
    label: str
    stage: int = 1     # 1 = Lexical Integration, 2 = Guided Learning, 3 = Fluency & Assessment
    body: str
    enabled: bool = True

    class Settings:
        name = "prompt_templates"
        indexes = [[("audience", pymongo.ASCENDING), ("slot", pymongo.ASCENDING)]]


class PromptLesson(AuditedDocument):
    """One day of the curriculum: (audience, week, day).

    Holds only what varies day to day — the topic, the conversation sequence the
    AI must follow, and the target collocations per accent. ``overrides`` stores
    a fully hand-written body for an individual slot when an admin edits that one
    prompt; unset slots keep rendering from the shared PromptTemplate."""
    audience: PromptAudience = PromptAudience.adults
    week: int          # 1..PROMPT_WEEKS
    day: int           # 1..PROMPT_DAYS_PER_WEEK
    day_topic: str     # Conversation | IELTS Speaking | GD / Debate ... | Job Interview
    title: str = ""
    context: str = ""  # scenario/context the conversation is set in
    conversation_sequence: list[str] = Field(default_factory=list)
    # Target collocations & expressions keyed by accent: british | american | international
    target_expressions: dict[str, list[str]] = Field(default_factory=dict)
    # slot key -> fully custom prompt body (admin edit of a single prompt)
    overrides: dict[str, str] = Field(default_factory=dict)
    published: bool = True

    class Settings:
        name = "prompt_lessons"
        indexes = [
            [("audience", pymongo.ASCENDING), ("week", pymongo.ASCENDING), ("day", pymongo.ASCENDING)],
        ]


class AISession(AuditedDocument):
    """One student's run through a single day's prompt in one of the three
    stages. The state machine lives in modules/ai_session/service.py; this is
    the durable record so a session survives a reload."""
    student_id: str
    audience: PromptAudience = PromptAudience.adults
    week: int
    day: int
    stage: int                 # 1 | 2 | 3
    accent: str = "international"   # resolved from Student.preferred_english
    cefr_level: str = "B1"          # resolved from Student.cefr_level
    language: str = "en"            # for correction explanations (Stage 2)
    status: str = "active"     # active | completed | abandoned
    sequence_index: int = 0    # how far through conversation_sequence we are
    sequence_total: int = 0
    # Stage 1 & 2 block the conversation until the student repeats the model answer.
    awaiting_repetition: bool = False
    pending_model_answer: Optional[str] = None
    # [{role: tutor|student|system, text, kind, created_at}]
    messages: list[dict] = Field(default_factory=list)
    # Stage 3 only — six scores out of 10, filled once every sequence is done.
    assessment: Optional[dict] = None
    completed_at: Optional[datetime] = None

    class Settings:
        name = "ai_sessions"
        indexes = [
            [("student_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)],
            [("student_id", pymongo.ASCENDING), ("week", pymongo.ASCENDING), ("day", pymongo.ASCENDING)],
        ]


# ---------------------------------------------------------------------------
# Attendance confirmation (24h notice → 18h deadline → auto-cancel)
# ---------------------------------------------------------------------------
class ClassConfirmation(AuditedDocument):
    """A student's required attendance confirmation for one upcoming class.

    Created by the scheduler 24h before the class. If the student has not
    responded by ``deadline_at`` (notification + 18h) their seat is cancelled
    automatically and they are notified once. ``source`` distinguishes the two
    kinds of class this applies to; ``class_ref`` is the Batch id or the
    SpeakingTeam id accordingly."""
    source: str        # batch | community
    class_ref: str     # Batch.id or SpeakingTeam.id
    class_title: str = ""
    class_date: str    # "YYYY-MM-DD" (IST)
    class_time: Optional[str] = None
    student_id: str
    status: str = "pending"  # pending | confirmed | declined | expired
    notified_at: datetime = Field(default_factory=utcnow)
    deadline_at: datetime = Field(default_factory=utcnow)
    responded_at: Optional[datetime] = None
    # Idempotency guard — the cancellation notice is sent exactly once.
    cancel_notified: bool = False

    class Settings:
        name = "class_confirmations"
        indexes = [
            [("student_id", pymongo.ASCENDING), ("status", pymongo.ASCENDING)],
            [("source", pymongo.ASCENDING), ("class_ref", pymongo.ASCENDING),
             ("class_date", pymongo.ASCENDING), ("student_id", pymongo.ASCENDING)],
            [("status", pymongo.ASCENDING), ("deadline_at", pymongo.ASCENDING)],
        ]


# ---------------------------------------------------------------------------
# Multilingual instructions (Student Profile → Instructions)
# ---------------------------------------------------------------------------
class Instruction(AuditedDocument):
    """An admin-managed instruction article shown in the student profile.

    ``translations`` maps a language code to {title, body}. The student sees
    their ``preferred_language``, falling back to ``fallback_language`` (and
    ultimately English) when that translation has not been written yet."""
    key: Indexed(str, unique=True)  # type: ignore  # stable slug, e.g. "getting-started"
    audience: str = "students"      # students | teachers | partners | *
    display_order: int = 0
    fallback_language: str = "en"
    # lang code -> {"title": str, "body": str}
    translations: dict[str, dict] = Field(default_factory=dict)
    published: bool = True

    class Settings:
        name = "instructions"
        indexes = [[("audience", pymongo.ASCENDING), ("display_order", pymongo.ASCENDING)]]


# ---------------------------------------------------------------------------
# Notifications / Leads / Audit
# ---------------------------------------------------------------------------
class Notification(AuditedDocument):
    # recipient: a student_id/username, "*" for everyone, or a group:
    # "students" | "teachers" | "partners" | "examiners"
    recipient: str
    title: str
    body: str
    is_read: bool = False              # direct notifications
    read_by: list[str] = Field(default_factory=list)  # broadcast/group read tracking
    kind: str = "info"  # info | success | warning | payment | approval | promo | exam | community
    scheduled_for: Optional[datetime] = None
    sent: bool = True

    class Settings:
        name = "notifications"
        indexes = [[("recipient", pymongo.ASCENDING), ("is_read", pymongo.ASCENDING)]]


class PushSubscription(AuditedDocument):
    """Browser Web Push subscription for a logged-in user."""
    user_id: str
    endpoint: str
    p256dh: str
    auth: str
    user_agent: Optional[str] = None

    class Settings:
        name = "push_subscriptions"
        indexes = [
            [("user_id", pymongo.ASCENDING)],
            [("endpoint", pymongo.ASCENDING)],
        ]


class Banner(AuditedDocument):
    title: str
    message: Optional[str] = None
    image_url: Optional[str] = None
    cta_text: Optional[str] = None
    cta_link: Optional[str] = None
    audience: str = "public"  # public | students | teachers | partners
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    active: bool = True
    kind: str = "announcement"  # announcement | promo

    class Settings:
        name = "banners"


class Offer(AuditedDocument):
    """Exclusive targeted offer shown as a login pop-up in the student dashboard."""
    title: str
    body: str
    offer_type: str = "subscription_upgrade"  # subscription_upgrade | discount | limited_time | festival
    plan: Optional[str] = None   # SubscriptionPlan value the offer maps to
    amount: Optional[int] = None  # paise (offer price)
    target_student_ids: list[str] = Field(default_factory=list)  # empty = all students
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    active: bool = True

    class Settings:
        name = "offers"


class OfferResponse(AuditedDocument):
    """Permanent student responses. 'interested' redirects to payment; 'not_interested'
    permanently dismisses. Close (X) is session-only and stores nothing."""
    offer_id: str
    student_id: str
    response: str  # interested | not_interested | converted

    class Settings:
        name = "offer_responses"
        indexes = [[("student_id", pymongo.ASCENDING), ("offer_id", pymongo.ASCENDING)]]


class Lead(AuditedDocument):
    """Free-demo / marketing lead."""
    name: str
    phone: str
    email: Optional[EmailStr] = None
    source: str = "website"
    interest: Optional[str] = None
    # --- Learner profile captured on the Free Demo form ---
    age: Optional[int] = None
    # Derived from age, not asked: which demo group to place them in.
    demo_group: Optional[str] = None   # "kids" | "adults" (PromptAudience values)
    education: Optional[str] = None    # one of leads.router.EDUCATION_OPTIONS
    occupation: Optional[str] = None   # one of leads.router.OCCUPATION_OPTIONS
    demo_slot: Optional[str] = None    # one of leads.router.DEMO_SLOTS
    demo_date: Optional[str] = None    # "YYYY-MM-DD" — must fall on the slot's weekday
    heard_from: Optional[str] = None   # one of leads.router.HEARD_FROM_OPTIONS
    heard_from_detail: Optional[str] = None  # free text when heard_from == "Other"
    # Mandatory consent ticked before submitting the public form.
    consent_privacy: bool = False
    status: str = "new"  # new | contacted | demo_booked | converted | lost
    feedback: Optional[str] = None

    class Settings:
        name = "leads"
        indexes = [[("status", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)]]


class ActivityLog(AuditedDocument):
    actor: str
    role: Optional[str] = None
    action: str
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    ip: Optional[str] = None
    meta: dict = Field(default_factory=dict)

    class Settings:
        name = "activity_logs"
        indexes = [
            [("actor", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)],
            [("action", pymongo.ASCENDING)],
        ]


# The full registry Beanie initialises.
ALL_DOCUMENTS = [
    User, ActivationCode, Student,
    CommunityProfile, FriendRequest, Block, DirectMessage,
    SpeakingTeam, TeamMessage, TeamRead, TeamJoinRequest,
    SafetyCard, CommunityReport, ClassAttendance,
    Payment, PlanConfig, Subscription, BookProduct, InventoryTransaction, BookOrder,
    Teacher, BatchSeries, Batch, OrientationBatch, BatchMessage, Attendance, Remuneration, TeacherReview,
    Partner, PartnerLead, PartnerReport,
    Exam, ExamBooking, CEFRReport, Certificate,
    VideoCategory, Video, WatchHistory,
    PromptTemplate, PromptLesson, AISession, ClassConfirmation, Instruction,
    Notification, Banner, Offer, OfferResponse, Lead, ActivityLog, PushSubscription,
]
