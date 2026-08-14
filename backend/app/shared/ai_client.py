"""AI provider adapter for the conversation engine.

The three-stage state machine in modules/ai_session/service.py never talks to a
provider directly — it calls :func:`generate` with a structured request and gets
back a structured reply. That keeps stage logic, prompt rendering and session
persistence completely independent of which model is behind it.

Only the ``stub`` provider ships today (settings.AI_PROVIDER, default "stub").
It is deterministic, offline, and makes no network calls, so the whole flow —
sequence progression, the mandatory repetition gate, restart/explain/better
controls and Stage 3 scoring — is exercisable end to end. To add a real model,
implement a coroutine with the same signature as :func:`_stub_generate` and
register it in ``_PROVIDERS``; nothing else in the codebase changes.
"""
import hashlib
import logging

from app.core.config import settings
from app.core.exceptions import ValidationAppError

log = logging.getLogger("speakedge.ai")


class AIRequest:
    """One turn's worth of context handed to the provider."""

    def __init__(self, *, system_prompt: str, history: list[dict], student_text: str,
                 stage: int, cefr_level: str, accent: str, language: str,
                 sequence_step: str | None, target_expressions: list[str],
                 intent: str = "reply"):
        self.system_prompt = system_prompt
        self.history = history
        self.student_text = student_text
        self.stage = stage
        self.cefr_level = cefr_level
        self.accent = accent
        self.language = language
        self.sequence_step = sequence_step
        self.target_expressions = target_expressions
        # reply | better | explain | assess | open
        self.intent = intent


class AIReply:
    """Structured provider output the state machine can act on."""

    def __init__(self, *, text: str, correction: str | None = None,
                 model_answer: str | None = None, scores: dict | None = None,
                 provider: str = "stub"):
        self.text = text
        self.correction = correction
        # When set, stages 1 & 2 block the conversation until it is repeated.
        self.model_answer = model_answer
        self.scores = scores
        self.provider = provider

    def as_dict(self) -> dict:
        return {
            "text": self.text,
            "correction": self.correction,
            "model_answer": self.model_answer,
            "scores": self.scores,
            "provider": self.provider,
        }


# ---------------------------------------------------------------------------
# Stub provider — deterministic, offline
# ---------------------------------------------------------------------------
_ENCOURAGEMENT = [
    "Nice work — that came through clearly.",
    "Good effort, I followed you well.",
    "That's a solid attempt, well done.",
    "Lovely — you're expressing that more naturally now.",
]

_ACCENT_FLAVOUR = {
    "british": "British English",
    "american": "American English",
    "international": "Neutral International English",
}


def _pick(options: list[str], seed: str) -> str:
    """Deterministic choice so the same input always yields the same reply —
    tests stay stable and there is no hidden randomness in the transcript."""
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return options[digest[0] % len(options)]


def _polish(text: str) -> str:
    """Very small cosmetic clean-up standing in for a model's rewrite."""
    cleaned = " ".join((text or "").split())
    if not cleaned:
        return ""
    cleaned = cleaned[0].upper() + cleaned[1:]
    if cleaned[-1] not in ".?!":
        cleaned += "."
    return cleaned


async def _stub_generate(req: AIRequest) -> AIReply:
    accent_label = _ACCENT_FLAVOUR.get(req.accent, "Neutral International English")
    polished = _polish(req.student_text)

    if req.intent == "assess":
        # Deterministic but input-sensitive scores derived from the transcript,
        # so different sessions do not all score identically.
        seed = hashlib.sha256(
            (req.system_prompt + "|".join(m.get("text", "") for m in req.history)).encode()
        ).digest()
        keys = ["fluency", "grammar", "vocabulary", "pronunciation",
                "native_expressions", "overall_communication"]
        scores = {k: 6 + (seed[i] % 4) for i, k in enumerate(keys)}
        scores["overall_communication"] = round(
            sum(scores[k] for k in keys[:-1]) / (len(keys) - 1))
        return AIReply(
            text=(
                "That completes every step of our conversation. Here is your "
                f"assessment, based on {accent_label} at CEFR {req.cefr_level}."
            ),
            scores=scores,
        )

    if req.intent == "better":
        return AIReply(
            text="Here's a stronger way to say that:",
            model_answer=polished or "Could you say a little more about that?",
        )

    if req.intent == "explain":
        return AIReply(
            text=(
                f"Explanation (in {req.language}): the correction improves word order "
                "and article use, which is what makes the sentence sound native-like "
                f"at CEFR {req.cefr_level}."
            ),
        )

    if req.intent == "open":
        step = req.sequence_step or "Let's begin."
        opener = f"{step}"
        if req.stage == 1 and req.target_expressions:
            opener += (
                "\n\nTry to use one of today's expressions in your answer: "
                + ", ".join(f'"{e}"' for e in req.target_expressions[:3])
            )
        return AIReply(text=opener)

    # Normal turn.
    if req.stage == 3:
        # Fluency mode: flow only, no correction, no model answer.
        follow_up = req.sequence_step or "Tell me a little more about that."
        return AIReply(text=f"{_pick(_ENCOURAGEMENT, req.student_text)} {follow_up}")

    correction = (
        f"Let's tidy that up a little — watch your article use and word order "
        f"for {accent_label} at CEFR {req.cefr_level}."
    )
    reply_text = f"{_pick(_ENCOURAGEMENT, req.student_text)} {correction}"
    if req.stage == 1 and req.target_expressions:
        expr = _pick(req.target_expressions, req.student_text)
        if expr.lower() not in (req.student_text or "").lower():
            # The student missed the expression — supply it naturally.
            reply_text += f' A natural way to put it here is to say "{expr}".'
    return AIReply(
        text=reply_text,
        correction=correction,
        model_answer=polished or "Could you say that once more, a little more fully?",
    )


_PROVIDERS = {"stub": _stub_generate}


async def generate(req: AIRequest) -> AIReply:
    provider = (settings.AI_PROVIDER or "stub").lower()
    fn = _PROVIDERS.get(provider)
    if fn is None:
        raise ValidationAppError(
            f"AI provider '{provider}' is not configured on this server. "
            f"Available: {sorted(_PROVIDERS)}."
        )
    try:
        return await fn(req)
    except ValidationAppError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        # A provider failure must never 500 the session; the router turns this
        # into a typed error the UI can show with a Retry button.
        log.exception("AI provider %s failed", provider)
        raise ValidationAppError(
            "The AI tutor is temporarily unavailable. Please try again."
        ) from exc


def provider_name() -> str:
    return (settings.AI_PROVIDER or "stub").lower()


def is_stub() -> bool:
    return provider_name() == "stub"
