from django.db import migrations, models


class Migration(migrations.Migration):
    # Starts empty on purpose: an existing conversation whose newest message
    # came from the other person shows as unread until it's opened once, the
    # same as it does today after a reload. Backfilling "read" could hide a
    # message someone genuinely hasn't seen yet.

    dependencies = [
        ("portal", "0016_connection_status_active"),
    ]

    operations = [
        migrations.AddField(
            model_name="connection",
            name="member_a_last_read_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="connection",
            name="member_b_last_read_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
