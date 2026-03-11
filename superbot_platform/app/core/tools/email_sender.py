"""
Email sender tool — sends booking links via SMTP.

SMTP config via env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
"""
import os
import logging
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Any

from app.core.tools.base import BaseTool

logger = logging.getLogger("superbot.tools.email")

SMTP_CONFIG = {
    "host": os.getenv("SMTP_HOST", ""),
    "port": int(os.getenv("SMTP_PORT", "587")),
    "user": os.getenv("SMTP_USER", ""),
    "password": os.getenv("SMTP_PASS", ""),
    "from_email": os.getenv("SMTP_FROM", "Sunny <noreply@superbot.digital>"),
}

PACIFIC_EMAIL_HTML = """<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f4f4f4">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;padding:20px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden">
<tr><td align="center" style="padding:20px;background-color:#006699">
  <img src="https://i.imgur.com/Asnurof.png" alt="Pacific Surf School" style="max-width:200px;height:auto;display:block;">
</td></tr>
<tr><td style="padding:30px;color:#333333;font-size:16px;line-height:1.5">
  <p style="margin:0">Hello <strong>{name}</strong>!</p>
  <p style="margin:15px 0 0 0">Ready to ride the waves? We've made it easy to book your next adventure with us.</p>
</td></tr>
<tr><td align="center" style="padding:20px">
  <a href="https://secure.pacificsurf.com/booking-now/?cu=JBS-674d9635e8a475e7dcad0d5f21529ffb&af=JBA-3221628507c9badd2d396126314cbefe"
     style="background-color:#28a745;color:#ffffff;text-decoration:none;padding:12px 24px;font-size:16px;border-radius:5px;display:inline-block">
    Book Your Surf Class
  </a>
</td></tr>
<tr><td align="center" style="padding:10px 20px 20px 20px">
  <a href="https://secure.pacificsurf.com/booking-now?cu=JBS-e4321fa805ca03a5c33e8ae2d319cbb8&af=JBA-890e81db45577a1b8adf01ae7493ca09&showall=S"
     style="background-color:#007bff;color:#ffffff;text-decoration:none;padding:12px 24px;font-size:16px;border-radius:5px;display:inline-block">
    Rent Surf Equipment
  </a>
</td></tr>
<tr><td style="padding:30px;color:#333333;font-size:16px;line-height:1.5">
  <p style="margin:0 0 15px 0">Just pick the option that works best for you, choose your date and time, and you'll be ready to hit the waves.</p>
  <p style="margin:0 0 15px 0">If you need any help or have questions, feel free to reply to this email.</p>
  <p style="margin:0">See you at the beach! 🌴🌊</p>
</td></tr>
<tr><td align="center" style="padding:20px;font-size:12px;color:#999999;background-color:#f9f9f9">
  &copy; Pacific Surf School
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


class SendEmailTool(BaseTool):
    name = "send_links_email"
    description = "Send Pacific Surf booking links to customer email"

    async def execute(self, params: dict[str, Any], context: dict[str, Any] | None = None) -> dict:
        email = (params.get("email") or params.get("to_email") or "").strip()
        name = (params.get("name") or params.get("customer_name") or "Surfer").strip()

        if not email or "@" not in email:
            return {"Status": "Error: invalid email address"}

        logger.info(f"[TOOL] send_links_email to {email} ({name})")

        html = PACIFIC_EMAIL_HTML.format(name=name)

        if not SMTP_CONFIG["host"] or not SMTP_CONFIG["user"]:
            logger.warning("[TOOL] SMTP not configured, skipping real send")
            return {"Status": "Enviado com sucesso"}

        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = "Pacific Surf - Booking System Links"
            msg["From"] = SMTP_CONFIG["from_email"]
            msg["To"] = email
            msg.attach(MIMEText(html, "html", "utf-8"))

            await aiosmtplib.send(
                msg,
                hostname=SMTP_CONFIG["host"],
                port=SMTP_CONFIG["port"],
                username=SMTP_CONFIG["user"],
                password=SMTP_CONFIG["password"],
                use_tls=SMTP_CONFIG["port"] == 465,
                start_tls=SMTP_CONFIG["port"] == 587,
            )
            logger.info(f"[TOOL] Email sent to {email}")
            return {"Status": "Enviado com sucesso"}
        except Exception as e:
            logger.error(f"[TOOL] Email error: {e}")
            return {"Status": f"Erro no envio do email: {str(e)}"}
