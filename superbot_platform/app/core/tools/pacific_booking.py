"""
Pacific Surf School booking tools — MySQL queries against JettBooking.

MySQL: 98.87.235.185:3306 / software (jettbooking_admin)
Credentials via env: PACIFIC_MYSQL_HOST, PACIFIC_MYSQL_USER, PACIFIC_MYSQL_PASS, PACIFIC_MYSQL_DB
"""
import os
import re
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.tools.base import BaseTool

logger = logging.getLogger("superbot.tools.pacific")

MYSQL_CONFIG = {
    "host": os.getenv("PACIFIC_MYSQL_HOST", "98.87.235.185"),
    "port": int(os.getenv("PACIFIC_MYSQL_PORT", "3306")),
    "user": os.getenv("PACIFIC_MYSQL_USER", "jettbooking_admin"),
    "password": os.getenv("PACIFIC_MYSQL_PASS", "JettB00kiing2025"),
    "db": os.getenv("PACIFIC_MYSQL_DB", "software"),
}

BASE_QUERY = """
SELECT
    pr.purchase_id AS purchase_code,
    pr.reservation_id AS reservation_code,
    r.reservation_date,
    CONCAT(p.first_name, ' ', p.last_name) AS customer,
    p.email AS customer_email,
    p.cell_phone AS customer_phone,
    school.name AS school_name,
    l.name AS lesson_type_name,
    SUM(ra.checkin = 1) AS checkins,
    SUM(ra.noshow = 1) AS noshows,
    GROUP_CONCAT(ra.name ORDER BY ra.name SEPARATOR ', ') AS attendees,
    w.id AS waiver_id
FROM reservations r
JOIN purchases_reservations pr ON pr.reservation_id = r.id
JOIN purchases p ON p.id = pr.purchase_id
JOIN schools school ON school.id = p.school_id
LEFT JOIN reservations_attendees ra ON ra.reservation_id = r.id
LEFT JOIN lessons l ON l.id = r.lesson_id
LEFT JOIN waivers w ON w.reservation_id = r.id
"""

GROUP_BY = """
GROUP BY p.school_id, pr.purchase_id, pr.reservation_id,
         r.reservation_date, r.lesson_id, r.id,
         p.first_name, p.last_name, p.email, p.cell_phone,
         school.name, l.name, w.id
"""


def _format_reservations(rows: list[dict]) -> dict:
    """Format MySQL rows into the response structure ElevenLabs expects."""
    now = datetime.now(timezone.utc)

    if not rows:
        return {
            "status": 404,
            "reason": "No reservation found",
            "total": 0,
            "eligible_count": 0,
            "data": [],
            "eligible_reservations": [],
            "completed_reservations": [],
        }

    data = []
    for r in rows:
        res_date = r.get("reservation_date")
        if res_date and not hasattr(res_date, "tzinfo"):
            # MySQL returns naive datetime in LA timezone
            from zoneinfo import ZoneInfo
            res_date = res_date.replace(tzinfo=ZoneInfo("America/Los_Angeles"))

        is_past = res_date < now if res_date else True
        checkins = int(r.get("checkins") or 0)
        is_used = checkins > 0

        friendly_date = ""
        friendly_time = ""
        if res_date:
            from zoneinfo import ZoneInfo
            la = ZoneInfo("America/Los_Angeles")
            local_dt = res_date.astimezone(la)
            friendly_date = local_dt.strftime("%A, %B %d, %Y")
            friendly_time = local_dt.strftime("%I:%M %p")

        status = "upcoming"
        if is_used:
            status = "completed"
        elif is_past:
            status = "missed"

        waiver_status = "Waiver not assign" if not r.get("waiver_id") else "Waiver signed"

        data.append({
            "purchase_code": str(r.get("purchase_code") or ""),
            "reservation_code": str(r.get("reservation_code") or ""),
            "reservation_date": str(res_date) if res_date else None,
            "friendly_date": friendly_date,
            "friendly_time": friendly_time,
            "customer": r.get("customer") or "",
            "customer_email": r.get("customer_email") or "",
            "customer_phone": r.get("customer_phone") or "",
            "school_name": r.get("school_name") or "",
            "checkins": str(checkins),
            "noshows": str(r.get("noshows") or 0),
            "attendees": r.get("attendees") or "",
            "lesson_type_name": r.get("lesson_type_name") or "Lesson",
            "flag_waiver": waiver_status,
            "status": status,
            "is_past": is_past,
            "is_used": is_used,
            "is_eligible": not is_past and not is_used,
        })

    eligible = [d for d in data if d["is_eligible"]]
    completed = [d for d in data if not d["is_eligible"]]

    return {
        "status": 200,
        "total": len(data),
        "eligible_count": len(eligible),
        "data": data,
        "eligible_reservations": eligible,
        "completed_reservations": completed,
    }


async def _query_mysql(query: str, params: tuple = ()) -> list[dict]:
    """Execute a MySQL query and return rows as dicts."""
    try:
        import aiomysql
    except ImportError:
        logger.error("aiomysql not installed")
        return []

    try:
        conn = await aiomysql.connect(
            host=MYSQL_CONFIG["host"],
            port=MYSQL_CONFIG["port"],
            user=MYSQL_CONFIG["user"],
            password=MYSQL_CONFIG["password"],
            db=MYSQL_CONFIG["db"],
            charset="utf8mb4",
            connect_timeout=10,
        )
        try:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(query, params)
                rows = await cur.fetchall()
                return list(rows)
        finally:
            conn.close()
    except Exception as e:
        logger.error(f"[PACIFIC_MYSQL] Error: {e}")
        return []


class SearchPurchaseTool(BaseTool):
    name = "search_purchase_id"
    description = "Search Pacific Surf booking by purchase/reservation ID"

    async def execute(self, params: dict[str, Any], context: dict[str, Any] | None = None) -> dict:
        raw_id = str(params.get("purchase_id", ""))
        # Normalize: strip non-digits, take last 5 digits
        clean_id = re.sub(r"\D", "", raw_id)
        if len(clean_id) > 5:
            clean_id = clean_id[-5:]

        if not clean_id:
            return {"status": 400, "reason": "No purchase ID provided"}

        logger.info(f"[TOOL] search_purchase_id: {clean_id}")

        query = BASE_QUERY + " WHERE pr.purchase_id = %s " + GROUP_BY
        rows = await _query_mysql(query, (clean_id,))
        return _format_reservations(rows)


class SearchPhoneTool(BaseTool):
    name = "search_booking_phone"
    description = "Search Pacific Surf booking by phone number"

    async def execute(self, params: dict[str, Any], context: dict[str, Any] | None = None) -> dict:
        raw_phone = str(params.get("phone_number", ""))
        # Normalize to US format (XXX) XXX-XXXX
        digits = re.sub(r"\D", "", raw_phone)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]

        if len(digits) != 10:
            return {"status": 400, "reason": f"Invalid phone: need 10 digits, got {len(digits)}"}

        search_pattern = f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        logger.info(f"[TOOL] search_booking_phone: {search_pattern}")

        query = (
            BASE_QUERY
            + " WHERE p.cell_phone LIKE %s"
            + " AND r.reservation_date >= CURDATE()"
            + " AND (r.status_id != 2 OR r.status_id IS NULL) "
            + GROUP_BY
            + " ORDER BY r.reservation_date ASC LIMIT 10"
        )
        rows = await _query_mysql(query, (f"%{search_pattern}%",))
        return _format_reservations(rows)
