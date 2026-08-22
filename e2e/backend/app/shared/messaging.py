"""SMS / WhatsApp messaging — future-ready stubs.

Real delivery needs a provider account (MSG91 / Gupshup / Twilio / Interakt
etc.). Until credentials are configured these functions log the intended
message and return False, so business flows can call them safely today and be
switched to a live provider with no call-site changes."""
import logging

from app.core.config import settings

log = logging.getLogger("speakedge.messaging")


def send_sms(to: str, message: str) -> bool:
    if not to:
        return False
    if not settings.SMS_PROVIDER:
        log.info("[SMS stub -> %s] %s", to, message)
        return False
    # TODO: integrate configured SMS provider here.
    log.info("[SMS -> %s via %s] %s", to, settings.SMS_PROVIDER, message)
    return True


def send_whatsapp(to: str, message: str) -> bool:
    if not to:
        return False
    if not settings.WHATSAPP_PROVIDER:
        log.info("[WhatsApp stub -> %s] %s", to, message)
        return False
    # TODO: integrate configured WhatsApp provider here.
    log.info("[WhatsApp -> %s via %s] %s", to, settings.WHATSAPP_PROVIDER, message)
    return True
