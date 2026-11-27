"""Locks out repeated failed sign-ins to the Django admin.

The admin can read every member's messages, so its login is the most
valuable thing on the server to guess a password for. After
ADMIN_LOGIN_MAX_FAILURES_PER_USERNAME failures for one username (from
anywhere), or ADMIN_LOGIN_MAX_FAILURES_PER_IP failures from one address
(across any usernames), sign-in is refused for ADMIN_LOGIN_LOCKOUT_MINUTES -
even with the right password, so a lucky guess during a lockout gets nothing.
It unlocks by itself; no one has to step in.
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.contrib.admin.forms import AdminAuthenticationForm
from django.core.exceptions import ValidationError
from django.utils import timezone

from .models import AdminLoginFailure

logger = logging.getLogger(__name__)

LOCKED_MESSAGE = "Too many failed sign-in attempts. Please wait {minutes} minutes and try again."


def client_ip(request):
    """The connecting client's address. Behind Railway's proxy REMOTE_ADDR is
    the proxy itself; the proxy appends the real client to X-Forwarded-For,
    so the right-most entry is the one a client can't forge."""
    if request is None:
        return "unknown"
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[-1].strip()[:64] or "unknown"
    return (request.META.get("REMOTE_ADDR") or "unknown")[:64]


def _window_start():
    return timezone.now() - timedelta(minutes=settings.ADMIN_LOGIN_LOCKOUT_MINUTES)


def is_locked_out(username, ip):
    recent = AdminLoginFailure.objects.filter(failed_at__gte=_window_start())
    if username and recent.filter(username=username).count() >= settings.ADMIN_LOGIN_MAX_FAILURES_PER_USERNAME:
        return True
    return recent.filter(ip_address=ip).count() >= settings.ADMIN_LOGIN_MAX_FAILURES_PER_IP


def record_failure(username, ip):
    AdminLoginFailure.objects.create(username=username[:150], ip_address=ip)
    # Keep the table small: nothing older than a day is ever needed.
    AdminLoginFailure.objects.filter(failed_at__lt=timezone.now() - timedelta(days=1)).delete()


class LockoutAdminAuthenticationForm(AdminAuthenticationForm):
    def clean(self):
        username = (self.cleaned_data.get("username") or "").strip().lower()
        ip = client_ip(self.request)
        if is_locked_out(username, ip):
            logger.warning("Admin sign-in refused during lockout for %r from %s", username, ip)
            raise ValidationError(
                LOCKED_MESSAGE.format(minutes=settings.ADMIN_LOGIN_LOCKOUT_MINUTES), code="locked_out"
            )
        try:
            cleaned = super().clean()
        except ValidationError:
            record_failure(username, ip)
            raise
        # A successful sign-in clears that username's count.
        AdminLoginFailure.objects.filter(username=username).delete()
        return cleaned
