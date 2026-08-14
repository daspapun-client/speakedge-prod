"""Seed script: creates the super-admin user, an examiner, sample plans data,
a demo activation-code batch, and a couple of banners. Idempotent — safe to
re-run. Usage:  python -m app.db.seed"""
import asyncio

from app.core.config import settings
from app.core.security import Role, hash_password
from app.db.models import Banner, Instruction, PromptAudience, User
from app.db.mongo import close_db, init_db
from app.modules.activation_code import service as code_service
from app.modules.prompt_library import service as prompt_service

# Starter instructions. Seeded only when the collection is empty — admins own
# the content thereafter (add languages via the Instructions admin page).
INSTRUCTION_SEEDS = [
    {
        "key": "getting-started",
        "display_order": 1,
        "translations": {
            "en": {
                "title": "Getting started with SpeakEdge",
                "body": (
                    "Welcome! Complete your orientation, set your CEFR level and "
                    "preferred English in your profile, then start Week 1 Day 1 in "
                    "the Learning section. Practise a little every day — consistency "
                    "matters more than long sessions."
                ),
            },
            "hi": {
                "title": "SpeakEdge की शुरुआत कैसे करें",
                "body": (
                    "स्वागत है! पहले अपना ओरिएंटेशन पूरा करें, प्रोफ़ाइल में अपना CEFR स्तर "
                    "और पसंदीदा अंग्रेज़ी चुनें, फिर Learning सेक्शन में सप्ताह 1 दिन 1 से "
                    "शुरू करें। हर दिन थोड़ा अभ्यास करें — निरंतरता सबसे ज़रूरी है।"
                ),
            },
            "bn": {
                "title": "SpeakEdge কীভাবে শুরু করবেন",
                "body": (
                    "স্বাগতম! প্রথমে ওরিয়েন্টেশন সম্পূর্ণ করুন, প্রোফাইলে আপনার CEFR স্তর ও "
                    "পছন্দের ইংরেজি নির্বাচন করুন, তারপর Learning বিভাগে সপ্তাহ ১ দিন ১ "
                    "থেকে শুরু করুন। প্রতিদিন অল্প অভ্যাস করুন — ধারাবাহিকতাই আসল।"
                ),
            },
        },
    },
    {
        "key": "how-ai-practice-works",
        "display_order": 2,
        "translations": {
            "en": {
                "title": "How AI practice works",
                "body": (
                    "Each day has three modes. Stage 1 (Lexical Integration) teaches "
                    "you the day's expressions. Stage 2 (Guided Learning) practises "
                    "them without hints. Stage 3 (Fluency & Assessment) lets you speak "
                    "freely and scores you out of 10 at the end. In Stages 1 and 2 the "
                    "tutor will ask you to repeat an improved sentence — the "
                    "conversation continues only after you do."
                ),
            },
            "hi": {
                "title": "AI अभ्यास कैसे काम करता है",
                "body": (
                    "हर दिन तीन मोड होते हैं। चरण 1 में दिन के वाक्यांश सिखाए जाते हैं, "
                    "चरण 2 में बिना संकेत अभ्यास होता है, और चरण 3 में आप स्वतंत्र रूप से "
                    "बोलते हैं और अंत में 10 में से अंक मिलते हैं। चरण 1 और 2 में शिक्षक "
                    "आपसे सुधारा हुआ वाक्य दोहराने को कहेंगे — दोहराने के बाद ही बातचीत आगे बढ़ेगी।"
                ),
            },
        },
    },
    {
        "key": "attendance-rules",
        "display_order": 3,
        "translations": {
            "en": {
                "title": "Class attendance rules",
                "body": (
                    "You will get an attendance reminder 24 hours before each class. "
                    "Please confirm within 18 hours. If we don't hear from you, your "
                    "seat is released automatically and you'll be notified. You can "
                    "always see pending requests under Attendance in your dashboard."
                ),
            },
            "hi": {
                "title": "कक्षा उपस्थिति नियम",
                "body": (
                    "हर कक्षा से 24 घंटे पहले आपको उपस्थिति की सूचना मिलेगी। कृपया 18 घंटे "
                    "के भीतर पुष्टि करें। उत्तर न मिलने पर आपकी सीट स्वतः रद्द कर दी जाएगी "
                    "और आपको सूचित किया जाएगा। लंबित अनुरोध डैशबोर्ड के Attendance में देखें।"
                ),
            },
        },
    },
]


async def seed() -> None:
    await init_db()

    # Super admin
    if not await User.find_one(User.username == settings.SUPER_ADMIN_EMAIL):
        await User(
            username=settings.SUPER_ADMIN_EMAIL,
            email=settings.SUPER_ADMIN_EMAIL,
            password_hash=hash_password(settings.SUPER_ADMIN_PASSWORD),
            role=Role.super_admin,
            full_name="Super Admin",
        ).insert()
        print(f"[seed] super_admin: {settings.SUPER_ADMIN_EMAIL} / {settings.SUPER_ADMIN_PASSWORD}")
    else:
        print("[seed] super_admin already exists")

    # Examiner (for exam report demo)
    if not await User.find_one(User.username == "examiner@speakedge.in"):
        await User(
            username="examiner@speakedge.in", email="examiner@speakedge.in",
            password_hash=hash_password("Examiner@123"), role=Role.examiner,
            full_name="Demo Examiner",
        ).insert()
        print("[seed] examiner: examiner@speakedge.in / Examiner@123")

    # Demo activation codes
    result = await code_service.generate_batch(5, "seed")
    print(f"[seed] demo activation codes: {result['codes']}")

    # Banners
    if not await Banner.find_one(Banner.kind == "announcement"):
        await Banner(text="Welcome to SpeakEdge — activate your book to begin!",
                     kind="announcement", active=True).insert()
        await Banner(text="Diamond plan now includes free CEFR exam eligibility.",
                     kind="promo", active=True).insert()
        print("[seed] banners created")

    # Prompt Library slot templates (5 per audience). Idempotent — an admin's
    # edits are never overwritten on a re-run.
    for audience in PromptAudience:
        tpls = await prompt_service.ensure_templates(audience)
        print(f"[seed] prompt templates ({audience.value}): {len(tpls)}")

    # Starter instructions
    for spec in INSTRUCTION_SEEDS:
        if await Instruction.find_one(Instruction.key == spec["key"]):
            continue
        await Instruction(**spec).insert()
        print(f"[seed] instruction: {spec['key']}")

    await close_db()
    print("[seed] done")


if __name__ == "__main__":
    asyncio.run(seed())
