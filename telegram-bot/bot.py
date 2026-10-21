#!/usr/bin/env python3
"""Telegram bot for Uns duas and VIP-gated reminders."""

import json
import logging
import os
import random
import tempfile
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, ApplicationBuilder, CommandHandler, ContextTypes

BASE_DIR = Path(__file__).resolve().parent.parent
DUAS_PATH = BASE_DIR / "duas.json"
DEFAULT_DATA_DIR = Path(__file__).resolve().parent
DATA_DIR_VALUE = os.getenv("TELEGRAM_BOT_DATA_DIR")
if os.getenv("BOT_ENV", "").lower() == "production" and not DATA_DIR_VALUE:
    raise RuntimeError("Set TELEGRAM_BOT_DATA_DIR to a private directory outside the web root.")
DATA_DIR = Path(DATA_DIR_VALUE).expanduser() if DATA_DIR_VALUE else DEFAULT_DATA_DIR
if not DATA_DIR.is_absolute():
    raise RuntimeError("TELEGRAM_BOT_DATA_DIR must be an absolute path.")
if os.getenv("BOT_ENV", "").lower() == "production":
    try:
        DATA_DIR.resolve().relative_to(BASE_DIR.resolve())
    except ValueError:
        pass
    else:
        raise RuntimeError("Production Telegram data must be stored outside the public web root.")
DATA_DIR.mkdir(parents=True, exist_ok=True)
REMINDERS_PATH = DATA_DIR / "chat_reminders.json"

MIN_INTERVAL_MINUTES = 25
MAX_INTERVAL_MINUTES = 30
REMINDER_TEXT = {
    "quran": "حان وقت ورد القرآن الكريم.",
    "morning": "حان وقت أذكار الصباح.",
    "evening": "حان وقت أذكار المساء.",
}
LOGGER = logging.getLogger("zad.telegram")


def utc_now():
    return datetime.now(timezone.utc)


def parse_datetime(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_duas():
    with DUAS_PATH.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError("duas.json must contain a JSON array.")
    return data


def read_reminders():
    if not REMINDERS_PATH.exists():
        return {}
    with REMINDERS_PATH.open("r", encoding="utf-8") as handle:
        records = json.load(handle)
    if not isinstance(records, dict):
        raise ValueError("chat_reminders.json must contain a JSON object.")
    return records


def write_reminders(records):
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=DATA_DIR,
            prefix=".chat-reminders-",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            json.dump(records, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, REMINDERS_PATH)
        try:
            REMINDERS_PATH.chmod(0o600)
        except OSError:
            LOGGER.debug("Could not restrict reminder database permissions on this platform.")
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def normalize_record(value):
    if not isinstance(value, dict):
        value = {}
    if isinstance(value.get("reminders"), dict):
        record = dict(value)
        record["reminders"] = {
            topic: setting
            for topic, setting in record["reminders"].items()
            if topic in REMINDER_TEXT and isinstance(setting, str)
        }
    else:
        # Preserve reminder schedules from the earlier bot data format.
        record = {"reminders": {
            topic: setting
            for topic, setting in value.items()
            if topic in REMINDER_TEXT and isinstance(setting, str)
        }}
    record.setdefault("vip_until", None)
    record.setdefault("expiration_notified", False)
    record.setdefault("linked_vip_active", False)
    record.setdefault("linked_vip_checked_at", None)
    record.setdefault("linked_vip_plan", None)
    record.setdefault("linked_vip_expires_at", None)
    record.setdefault("google_account_linked", False)
    return record


def get_record(records, chat_id, start_trial=False):
    del start_trial
    key = str(chat_id)
    record = normalize_record(records.get(key))
    records[key] = record
    return record


def access_status(record, now=None):
    now = now or utc_now()
    linked_check = parse_datetime(record.get("linked_vip_checked_at"))
    if record.get("linked_vip_active") is True and linked_check and now - linked_check <= timedelta(hours=1):
        return "vip", parse_datetime(record.get("linked_vip_expires_at"))
    vip_until = parse_datetime(record.get("vip_until"))
    if vip_until and vip_until > now:
        return "vip", vip_until
    return "expired", None


def subscription_keyboard():
    subscription_url = os.getenv("TELEGRAM_VIP_SUBSCRIPTION_URL", "").strip()
    parsed = urlparse(subscription_url)
    if parsed.scheme == "https" and parsed.netloc:
        return InlineKeyboardMarkup([[
            InlineKeyboardButton("اشتراك VIP", url=subscription_url)
        ]])
    return None


def telegram_auth_url(action):
    auth_url = os.getenv("TELEGRAM_AUTH_API_URL", "").strip()
    parsed = urlparse(auth_url)
    if (parsed.scheme != "https" or not parsed.netloc or parsed.path.rstrip("/").split("/")[-1] != "auth.php"
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        return None
    if action not in {"telegram-bot-link", "telegram-bot-status"}:
        raise ValueError("Unsupported Telegram account API action.")
    return f"{auth_url}?action={action}"


def telegram_api_headers():
    secret = os.getenv("TELEGRAM_BOT_API_SECRET", "")
    if len(secret) < 32:
        return None
    return {"Authorization": f"Bearer {secret}", "Accept": "application/json"}


async def link_google_account(token, chat_id):
    url = telegram_auth_url("telegram-bot-link")
    headers = telegram_api_headers()
    if url is None or headers is None:
        return False
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                url,
                headers=headers,
                json={"token": token, "chatId": str(chat_id)},
            )
    except (httpx.HTTPError, ValueError):
        LOGGER.exception("Could not link Telegram chat %s to its Google account.", chat_id)
        return False
    try:
        payload = response.json()
    except ValueError:
        return False
    return response.is_success and isinstance(payload, dict) and payload.get("linked") is True


async def refresh_google_vip(chat_id, record):
    url = telegram_auth_url("telegram-bot-status")
    headers = telegram_api_headers()
    if url is None or headers is None:
        return False
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(url, headers=headers, params={"chat_id": str(chat_id)})
        if not response.is_success:
            return False
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        LOGGER.exception("Could not refresh linked Telegram VIP status for chat %s.", chat_id)
        return False
    if (not isinstance(payload, dict) or not isinstance(payload.get("active"), bool)
            or (payload["active"] and not isinstance(payload.get("plan"), str))
            or (payload.get("expiresAt") is not None and not isinstance(payload.get("expiresAt"), str))):
        LOGGER.error("Telegram VIP status response was invalid for chat %s.", chat_id)
        return False
    record["linked_vip_active"] = payload["active"]
    record["linked_vip_checked_at"] = utc_now().isoformat()
    record["linked_vip_plan"] = payload.get("plan")
    record["linked_vip_expires_at"] = payload.get("expiresAt")
    return True


def access_message(record):
    status, expires_at = access_status(record)
    if status == "vip":
        if (record.get("linked_vip_active") is True
                and record.get("linked_vip_plan") == "telegram_lifetime"):
            return "اشتراك Telegram مدى الحياة مفعّل لحسابك."
        if expires_at is None:
            return "اشتراك VIP مفعّل."
        return f"اشتراك VIP مفعّل حتى {expires_at:%Y-%m-%d %H:%M UTC}."
    message = (
        "تذكيرات أُنْس الآلية تتطلب اشتراك VIP.\n"
        "اشترك الآن لتفعيل التذكير اليومي عبر Telegram، ثم استخدم /vip للتحقق من حالة الاشتراك."
    )
    if subscription_keyboard() is None:
        message += "\nرابط الاشتراك غير مهيأ حالياً؛ يرجى التواصل مع إدارة البوت."
    return message


async def send_access_prompt(message, record):
    text = access_message(record)
    await message.reply_text(text, reply_markup=subscription_keyboard())


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat is None or update.message is None:
        return
    if update.effective_chat.type != "private":
        await update.message.reply_text("ابدأ البوت في محادثة خاصة لتفعيل حسابك والتذكيرات.")
        return

    records = read_reminders()
    record = get_record(records, update.effective_chat.id)
    if context.args and context.args[0].startswith("link_"):
        token = context.args[0][5:]
        if not 40 <= len(token) <= 48 or not all(
                character.isascii() and (character.isalnum() or character in "_-")
                for character in token):
            await update.message.reply_text("رابط الربط غير صالح أو منتهي. أنشئ رابطاً جديداً من ملفك في أُنْس.")
            return
        if not await link_google_account(token, update.effective_chat.id):
            await update.message.reply_text("تعذر ربط الحساب. قد يكون الرابط منتهياً أو مستخدماً؛ أنشئ رابطاً جديداً من أُنْس.")
            return
        record["linked_vip_active"] = False
        record["linked_vip_checked_at"] = None
        record["google_account_linked"] = True
        write_reminders(records)
        await update.message.reply_text("تم ربط حساب Google ببوت أُنْس بنجاح. يمكنك الآن إكمال الاشتراك من صفحة أُنْس.")
    await refresh_access(update.effective_chat.id, record)
    status, _ = access_status(record)
    write_reminders(records)
    if status == "expired":
        await send_access_prompt(update.message, record)
        return

    if status == "vip":
        await update.message.reply_text(access_message(record))
        restore_chat_reminders(context.application, update.effective_chat.id, record)
        return

    await update.message.reply_text("أهلاً بك في بوت أُنْس 🌿")
    await send_access_prompt(update.message, record)


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    del context
    if update.message is None:
        return
    await update.message.reply_text(
        "الأوامر المتاحة:\n"
        "• /start - تفعيل حالة الحساب والاشتراك\n"
        "• /dua - اعرض دعاءً عشوائياً\n"
        "• /remind 25m quran|morning|evening - تذكير دوري كل 25 إلى 30 دقيقة\n"
        "• /remind HH:MM quran|morning|evening - تذكير يومي\n"
        "• /remind off [quran|morning|evening] - إلغاء التذكير\n"
        "• /vip - حالة اشتراك VIP\n"
        "• /subscribe - معلومات الاشتراك\n"
        "• /progress المنجز الإجمالي - ملخص التقدم\n"
    )


async def dua_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    del context
    if update.message is None:
        return
    try:
        items = load_duas()
    except (OSError, json.JSONDecodeError, ValueError):
        LOGGER.exception("Could not load the dua list.")
        await update.message.reply_text("تعذر تحميل الأدعية حالياً. حاول مرة أخرى لاحقاً.")
        return
    if not items:
        await update.message.reply_text("لا توجد أدعية مضافة حاليًا.")
        return
    item = random.choice(items)
    title = item.get("title", "دعاء")
    text = item.get("text", "")
    category = item.get("category", "عام")
    await update.message.reply_text(
        f"*{title}*\n\n{text}\n\n_الفئة: {category}_",
        parse_mode="Markdown",
    )


def reminder_job_name(chat_id, topic):
    return f"reminder:{chat_id}:{topic}"


def remove_reminder_jobs(application, chat_id, topic):
    if application.job_queue is None:
        return
    for job in application.job_queue.get_jobs_by_name(reminder_job_name(chat_id, topic)):
        job.schedule_removal()


def schedule_reminder(application, chat_id, topic, setting):
    if application.job_queue is None:
        raise RuntimeError(
            "Install python-telegram-bot with the [job-queue] extra to enable reminders."
        )
    remove_reminder_jobs(application, chat_id, topic)
    job_name = reminder_job_name(chat_id, topic)
    job_data = {"topic": topic}
    if setting.startswith("every:"):
        minutes = int(setting.partition(":")[2])
        application.job_queue.run_repeating(
            send_reminder,
            interval=minutes * 60,
            first=minutes * 60,
            name=job_name,
            chat_id=chat_id,
            data=job_data,
        )
        return

    hour, minute = (int(part) for part in setting.split(":", maxsplit=1))
    reminder_time = time(
        hour,
        minute,
        tzinfo=ZoneInfo(os.getenv("BOT_TIMEZONE", "UTC")),
    )
    application.job_queue.run_daily(
        send_reminder,
        time=reminder_time,
        name=job_name,
        chat_id=chat_id,
        data=job_data,
    )


def restore_chat_reminders(application, chat_id, record):
    for topic, setting in record["reminders"].items():
        try:
            schedule_reminder(application, chat_id, topic, setting)
        except (RuntimeError, ValueError, ZoneInfoNotFoundError):
            LOGGER.exception("Could not restore reminder for linked chat %s.", chat_id)


async def refresh_access(chat_id, record):
    if record.get("google_account_linked") is True:
        await refresh_google_vip(chat_id, record)
    return access_status(record)


async def send_reminder(context: ContextTypes.DEFAULT_TYPE):
    job = context.job
    if job is None or job.chat_id is None:
        return
    chat_id = str(job.chat_id)
    topic = job.data.get("topic")
    if topic not in REMINDER_TEXT:
        job.schedule_removal()
        return

    records = read_reminders()
    record = get_record(records, chat_id)
    access, _ = await refresh_access(chat_id, record)
    if access == "expired":
        for active_topic in record["reminders"]:
            remove_reminder_jobs(context.application, chat_id, active_topic)
        record["reminders"].clear()
        should_notify = not record["expiration_notified"]
        record["expiration_notified"] = True
        write_reminders(records)
        if should_notify:
            await context.bot.send_message(
                chat_id=job.chat_id,
                text=access_message(record),
                reply_markup=subscription_keyboard(),
            )
        return

    await context.bot.send_message(chat_id=job.chat_id, text=REMINDER_TEXT[topic])


async def reminder_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_chat is None or update.message is None:
        return
    if update.effective_chat.type != "private":
        await update.message.reply_text("التذكيرات الآلية متاحة في المحادثات الخاصة فقط.")
        return

    chat_id = str(update.effective_chat.id)
    records = read_reminders()
    record = get_record(records, chat_id)
    args = context.args
    if not args:
        await refresh_access(chat_id, record)
        await send_access_prompt(update.message, record)
        await update.message.reply_text(
            "الإعداد: /remind 25m quran أو /remind 07:00 morning.\n"
            "الإلغاء: /remind off quran"
        )
        write_reminders(records)
        return

    action = args[0].lower()
    if action == "off":
        if len(args) == 1:
            topics = list(record["reminders"])
        elif len(args) == 2 and args[1].lower() in REMINDER_TEXT:
            topics = [args[1].lower()]
        else:
            await update.message.reply_text("حدد نوع تذكير صالحاً بعد off.")
            return
        for topic in topics:
            remove_reminder_jobs(context.application, chat_id, topic)
            record["reminders"].pop(topic, None)
        write_reminders(records)
        await update.message.reply_text("تم إلغاء التذكير المحدد.")
        return

    if len(args) != 2 or args[1].lower() not in REMINDER_TEXT:
        await update.message.reply_text(
            "حدد نوع التذكير: quran أو morning أو evening. "
            "مثال /remind 25m quran أو /remind 07:00 morning."
        )
        return

    status, _ = await refresh_access(chat_id, record)
    if status == "expired":
        write_reminders(records)
        await send_access_prompt(update.message, record)
        return
    if context.application.job_queue is None:
        await update.message.reply_text(
            "التذكيرات غير مفعّلة على الخادم. ثبّت متطلبات البوت مع job-queue."
        )
        return

    topic = args[1].lower()
    try:
        if action.endswith("m") and action[:-1].isdigit():
            interval = int(action[:-1])
            if not MIN_INTERVAL_MINUTES <= interval <= MAX_INTERVAL_MINUTES:
                raise ValueError("interval")
            setting = f"every:{interval}"
        else:
            hour_text, minute_text = action.split(":", maxsplit=1)
            hour, minute = int(hour_text), int(minute_text)
            if not 0 <= hour <= 23 or not 0 <= minute <= 59:
                raise ValueError("time")
            ZoneInfo(os.getenv("BOT_TIMEZONE", "UTC"))
            setting = f"{hour:02d}:{minute:02d}"
    except (ValueError, ZoneInfoNotFoundError):
        await update.message.reply_text(
            "الوقت اليومي بصيغة 24 ساعة مثل 07:30، أو اختر فاصلاً من 25m إلى 30m."
        )
        return

    try:
        schedule_reminder(context.application, chat_id, topic, setting)
    except (RuntimeError, ValueError, ZoneInfoNotFoundError):
        LOGGER.exception("Could not schedule reminder for chat %s.", chat_id)
        await update.message.reply_text("تعذر ضبط التذكير حالياً. حاول مرة أخرى لاحقاً.")
        return
    record["reminders"][topic] = setting
    write_reminders(records)
    await update.message.reply_text(
        f"تم ضبط تذكير {topic}: "
        f"كل {setting.partition(':')[2]} دقيقة." if setting.startswith("every:")
        else f"تم ضبط تذكير {topic} يومياً عند {setting}."
    )


async def vip_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    del context
    if update.effective_chat is None or update.message is None:
        return
    records = read_reminders()
    record = get_record(records, update.effective_chat.id)
    await refresh_access(update.effective_chat.id, record)
    write_reminders(records)
    await send_access_prompt(update.message, record)


async def subscribe_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await vip_command(update, context)


async def progress_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    del context
    if update.message is None:
        return
    if len(context.args) != 2:
        await update.message.reply_text("أرسل /progress المنجز الإجمالي، مثال: /progress 13 20")
        return
    try:
        completed, total = (int(value) for value in context.args)
    except ValueError:
        await update.message.reply_text("أدخل عددين صحيحين لإرسال ملخص التقدم.")
        return
    if total < 1 or completed < 0 or completed > total:
        await update.message.reply_text("يجب أن يكون الإجمالي أكبر من صفر والمنجز بين صفر والإجمالي.")
        return
    percent = round(completed / total * 100)
    await update.message.reply_text(f"إنجاز الأذكار اليوم: {completed} من {total} ({percent}%).")


def configured_admin_ids():
    values = os.getenv("TELEGRAM_ADMIN_IDS", "").split(",")
    return {value.strip() for value in values if value.strip().isdigit()}


async def grant_vip_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user is None or update.message is None:
        return
    admins = configured_admin_ids()
    if not admins or str(update.effective_user.id) not in admins:
        await update.message.reply_text("هذا الأمر مخصص لإدارة البوت.")
        return
    if len(context.args) != 2:
        await update.message.reply_text("الاستخدام الإداري: /grantvip CHAT_ID DAYS")
        return
    try:
        chat_id = str(int(context.args[0]))
        days = int(context.args[1])
    except ValueError:
        await update.message.reply_text("أدخل معرف محادثة وعدداً صحيحاً للأيام.")
        return
    if int(chat_id) <= 0:
        await update.message.reply_text("استخدم معرف محادثة خاصة موجباً وصحيحاً.")
        return
    if days < 1 or days > 3650:
        await update.message.reply_text("مدة VIP يجب أن تكون بين يوم واحد و3650 يوماً.")
        return

    records = read_reminders()
    record = get_record(records, chat_id)
    current_vip_until = parse_datetime(record.get("vip_until"))
    begins_at = max(utc_now(), current_vip_until) if current_vip_until else utc_now()
    record["vip_until"] = (begins_at + timedelta(days=days)).isoformat()
    record["expiration_notified"] = False
    if context.application.job_queue is not None:
        for topic, setting in record["reminders"].items():
            try:
                schedule_reminder(context.application, chat_id, topic, setting)
            except (RuntimeError, ValueError, ZoneInfoNotFoundError):
                LOGGER.exception("Could not restore VIP reminder for chat %s.", chat_id)
    write_reminders(records)
    if update.effective_chat:
        await update.effective_chat.send_message(
            f"تم تفعيل VIP للمحادثة {chat_id} لمدة {days} يوماً."
        )


async def restore_reminders(application: Application):
    records = read_reminders()
    timezone_name = os.getenv("BOT_TIMEZONE", "UTC")
    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise RuntimeError("BOT_TIMEZONE must be a valid IANA timezone.") from exc

    for chat_id, stored_record in records.items():
        record = normalize_record(stored_record)
        records[chat_id] = record
        if record["google_account_linked"]:
            await refresh_google_vip(chat_id, record)
        if access_status(record)[0] == "expired":
            continue
        for topic, setting in record["reminders"].items():
            try:
                if setting.startswith("every:"):
                    interval = int(setting.partition(":")[2])
                    if not MIN_INTERVAL_MINUTES <= interval <= MAX_INTERVAL_MINUTES:
                        continue
                else:
                    hour, minute = (int(part) for part in setting.split(":", maxsplit=1))
                    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
                        continue
                schedule_reminder(application, chat_id, topic, setting)
            except (ValueError, ZoneInfoNotFoundError):
                LOGGER.warning("Skipped invalid stored reminder for chat %s.", chat_id)
    write_reminders(records)


async def sync_linked_subscriptions(context: ContextTypes.DEFAULT_TYPE):
    records = read_reminders()
    changed = False
    for chat_id, stored_record in records.items():
        record = normalize_record(stored_record)
        if not record["google_account_linked"]:
            continue
        previous_active = record["linked_vip_active"] is True
        if not await refresh_google_vip(chat_id, record):
            continue
        active = record["linked_vip_active"] is True
        if active != previous_active:
            changed = True
            record["expiration_notified"] = False
            if active:
                restore_chat_reminders(context.application, chat_id, record)
                activation_message = (
                    "تم تفعيل اشتراك أُنْس Telegram مدى الحياة. اضبط تذكيراتك باستخدام /remind."
                    if record.get("linked_vip_plan") == "telegram_lifetime"
                    else "تم تفعيل اشتراك VIP لحسابك المرتبط. اضبط تذكيراتك باستخدام /remind."
                )
                await context.bot.send_message(
                    chat_id=int(chat_id),
                    text=activation_message,
                )
            else:
                for topic in record["reminders"]:
                    remove_reminder_jobs(context.application, chat_id, topic)
                await context.bot.send_message(
                    chat_id=int(chat_id),
                    text="حالة اشتراك Telegram المرتبط لم تعد نشطة. تحقق من حسابك في أُنْس.",
                )
        records[chat_id] = record
    if changed:
        write_reminders(records)


def main():
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("Set the TELEGRAM_BOT_TOKEN environment variable before running this bot.")

    application = ApplicationBuilder().token(token).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("dua", dua_command))
    application.add_handler(CommandHandler("remind", reminder_command))
    application.add_handler(CommandHandler("vip", vip_command))
    application.add_handler(CommandHandler("subscribe", subscribe_command))
    application.add_handler(CommandHandler("grantvip", grant_vip_command))
    application.add_handler(CommandHandler("progress", progress_command))
    application.post_init = restore_reminders
    if (
        application.job_queue is not None
        and telegram_auth_url("telegram-bot-status") is not None
        and telegram_api_headers() is not None
    ):
        application.job_queue.run_repeating(sync_linked_subscriptions, interval=60, first=15)

    LOGGER.info("Uns Telegram bot started.")
    application.run_polling()


if __name__ == "__main__":
    main()
