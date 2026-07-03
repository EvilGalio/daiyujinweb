"""Test SMTP connection using .env configuration."""
import os, sys, smtplib
from email.message import EmailMessage
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ENV = BACKEND / ".env"


def load_env():
    config = {}
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                config[k.strip()] = v.strip().strip('"').strip("'")
    return config


def main():
    config = load_env()

    host = config.get("SMTP_HOST", "smtppro.zoho.com")
    port = int(config.get("SMTP_PORT", "465"))
    username = config.get("SMTP_USERNAME", "")
    password = config.get("SMTP_PASSWORD", "")
    from_addr = config.get("SMTP_FROM", username)
    from_name = config.get("SMTP_FROM_NAME", "GCNOV Online Quote")
    recipients = config.get("QUOTE_EMAIL_RECIPIENTS", "").split(",")

    if not username or not password:
        print("Error: SMTP_USERNAME or SMTP_PASSWORD not set in .env")
        return 1

    print(f"Connecting to {host}:{port} as {username}")
    print(f"From: {from_name} <{from_addr}>")
    print(f"To: {', '.join(r.strip() for r in recipients if r.strip())}")

    try:
        msg = EmailMessage()
        msg["From"] = f"{from_name} <{from_addr}>"
        msg["To"] = ", ".join(r.strip() for r in recipients if r.strip())
        msg["Subject"] = "[SMTP Test] Daiyujin Quote Notification Test"
        msg.set_content("This is a test email from the Daiyujin Tools SMTP configuration.\n\nIf you received this, the SMTP connection is working correctly.")
        msg.add_alternative(
            "<html><body><h2>SMTP Test</h2><p>This is a test email. SMTP connection is working correctly.</p></body></html>",
            subtype="html",
        )

        with smtplib.SMTP_SSL(host, port, timeout=12) as smtp:
            smtp.login(username, password)
            smtp.send_message(msg)

        print("\n✓ Test email sent successfully!")
        return 0

    except smtplib.SMTPAuthenticationError:
        print("\n✗ Authentication failed. Check SMTP_USERNAME and SMTP_PASSWORD.")
        print("  If using Zoho with 2FA, generate an application-specific password.")
        return 1
    except smtplib.SMTPException as e:
        print(f"\n✗ SMTP error: {e}")
        return 1
    except OSError as e:
        print(f"\n✗ Connection error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
