from typing import Optional

from pydantic import BaseModel, EmailStr, Field

from app.core.security import MIN_PASSWORD_LENGTH


class LoginRequest(BaseModel):
    username: str  # email or student_id
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    subject: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH)


class ForgotPasswordRequest(BaseModel):
    username: str  # email or student_id / staff username


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH)


class MeOut(BaseModel):
    subject: str
    role: str
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    student_id: Optional[str] = None
