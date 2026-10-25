from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    """Keeps one Django admin login in sync with DJANGO_SUPERUSER_* env vars.

    Unlike the built-in createsuperuser, this is safe to run on every
    deploy: no-ops when the vars aren't set, and when they are, it updates
    the existing account's password instead of erroring if it already
    exists - so rotating the password is just changing the Railway variable
    and redeploying.
    """

    help = "Create or update the admin login from DJANGO_SUPERUSER_USERNAME/EMAIL/PASSWORD."

    def handle(self, *args, **options):
        import os

        username = os.environ.get("DJANGO_SUPERUSER_USERNAME")
        password = os.environ.get("DJANGO_SUPERUSER_PASSWORD")
        email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "")

        if not username or not password:
            self.stdout.write("DJANGO_SUPERUSER_USERNAME/PASSWORD not set - skipping.")
            return

        User = get_user_model()
        with transaction.atomic():
            user, created = User.objects.get_or_create(
                username=username, defaults={"email": email, "is_staff": True, "is_superuser": True}
            )
            user.email = email
            user.is_staff = True
            user.is_superuser = True
            user.set_password(password)
            user.save()

        self.stdout.write(f"{'Created' if created else 'Updated'} admin login for '{username}'.")
