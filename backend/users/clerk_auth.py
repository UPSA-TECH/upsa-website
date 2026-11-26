"""Verifies Clerk session tokens and maps them to Django users.

Clerk handles sign-up/sign-in/sign-out entirely on the frontend. Django's only
job is to check that a request carries a genuine Clerk session token and
figure out which local user it belongs to - no passwords, no login views here.
"""
import logging

import jwt
from django.conf import settings
from django.core.cache import cache
from django.contrib.auth import get_user_model
from jwt import PyJWKClient
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import ClerkIdentity

logger = logging.getLogger(__name__)

_jwks_client = None

CLOCK_SKEW_LEEWAY_SECONDS = 10
MISSING_AZP_LOG_EVERY_SECONDS = 24 * 60 * 60


def _log_missing_azp(clerk_user_id):
    # The portal polls every 30 seconds, so logging every request would bury
    # everything else - once per user per day is enough to see who's affected.
    if cache.add(f"clerk-missing-azp:{clerk_user_id}", True, MISSING_AZP_LOG_EVERY_SECONDS):
        logger.warning(
            "Accepted a Clerk token with no azp claim for user %s. "
            "If this never shows up for real members, CLERK_REQUIRE_AZP can be turned on.",
            clerk_user_id,
        )


def _get_jwks_client():
    global _jwks_client
    if not settings.CLERK_ISSUER:
        raise AuthenticationFailed("CLERK_ISSUER is not configured on the server.")
    if _jwks_client is None:
        _jwks_client = PyJWKClient(f"{settings.CLERK_ISSUER}/.well-known/jwks.json")
    return _jwks_client


class ClerkJWTAuthentication(BaseAuthentication):
    """DRF authentication backed by a Clerk session token.

    Expects `Authorization: Bearer <clerk session token>` (the token the
    frontend gets from Clerk's `getToken()`). On success, `request.user` is
    the matching Django user and `request.auth` is the decoded token claims.
    """

    keyword = "Bearer"

    def authenticate(self, request):
        header = request.META.get("HTTP_AUTHORIZATION", "")
        if not header.startswith(f"{self.keyword} "):
            return None

        token = header[len(self.keyword) + 1 :]

        try:
            signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                issuer=settings.CLERK_ISSUER,
                options={"require": ["exp", "iat", "sub"]},
                # Server clocks drift by a second or two; without this a token
                # issued "just now" gets rejected as not yet valid (iat).
                leeway=CLOCK_SKEW_LEEWAY_SECONDS,
            )
        except jwt.PyJWTError as exc:
            raise AuthenticationFailed(f"Invalid Clerk token: {exc}") from exc

        # "azp" is the site the token was issued to. Reject tokens minted for
        # some other site. Tokens without the claim are only rejected once
        # CLERK_REQUIRE_AZP is on (see settings for why it starts off).
        authorized_party = claims.get("azp")
        allowed = settings.CLERK_AUTHORIZED_PARTIES
        if authorized_party:
            if allowed and authorized_party not in allowed:
                raise AuthenticationFailed("Token was issued for a different site.")
        elif allowed:
            if settings.CLERK_REQUIRE_AZP:
                raise AuthenticationFailed("Token is missing the site it was issued for.")
            _log_missing_azp(claims["sub"])

        user = self._get_or_create_user(claims["sub"])
        # Unticking "Active" on a user in the Django admin is the hard ban: a
        # valid Clerk session is no longer enough to get in at all.
        if not user.is_active:
            raise AuthenticationFailed("This account has been disabled.")
        return (user, claims)

    def _get_or_create_user(self, clerk_user_id):
        # The portal fires several requests at once on first load, so a brand
        # new user hits this concurrently - get_or_create keeps that safe.
        user, _ = get_user_model().objects.get_or_create(username=f"clerk:{clerk_user_id}")
        identity, _ = ClerkIdentity.objects.get_or_create(clerk_id=clerk_user_id, defaults={"user": user})
        return identity.user
