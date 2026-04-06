# Bin Hassan Bespoke

Bin Hassan Bespoke is a full-stack tailor workshop system with:
- React PWA frontend
- Serverless backend APIs in `api/`
- Google Sheets as the source of truth
- Role-based access (`admin`, `shop`, `karigar`, `cutting`)
- Photo-based workflow verification with Google Vision OCR

## What Changed (v2)
- Added `cutting` role and dedicated cutting interface.
- Replaced manual cutting/karigar completion status updates with photo-upload verification.
- Admin now uploads one reference measurement slip per order.
- Cutting worker uploads cutting photo (fabric + slip) to auto-verify and mark cut.
- Karigar uploads completion photo (finished piece + slip) to auto-verify and mark complete.
- Added Track & Alerts section in admin for overdue/today/tomorrow risk and delay monitoring.

## Required Environment Variables
Copy `.env.example` to `.env` and configure:

- `GOOGLE_SHEETS_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `JWT_SECRET`
- `POLL_INTERVAL_MS` (optional)

Photo upload (recommended):
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Verification flag:
- `SKIP_VISION_VERIFICATION` (default `false`; keep false in production)

## Google Sheets Tabs
Auto-created and schema-managed by API:
- `Users`
- `Shops`
- `Karigar`
- `Orders`
- `OrderItems`
- `Pieces`
- `Payments_Shops`
- `Payments_Karigar`
- `Settings`
- `ShopRates`
- `KarigarRates`

## New Data Columns
Orders:
- `slip_photo_url`

Pieces:
- `reference_slip_url`
- `cutting_photo_url`
- `cutting_verified`
- `cutting_verified_date`
- `completion_photo_url`
- `completion_verified`
- `completion_verified_date`
- `assigned_date`

## Bootstrap First Admin
If `Users` tab is empty:

`POST /api/bootstrap`

```json
{
  "bootstrap_key": "<JWT_SECRET>",
  "admin_username": "admin",
  "admin_password": "your-password",
  "admin_display_name": "Admin"
}
```

## Core Endpoints
- `POST /api/login`
- `GET /api/me`
- `GET /api/snapshot`
- `GET|POST|PATCH /api/orders`
- `POST /api/pieces-cut`
- `POST /api/pieces-assign`
- `POST /api/pieces-complete`
- `GET|POST|PATCH /api/shops`
- `GET|POST|PATCH /api/karigar`
- `GET|POST /api/rates-shop`
- `GET|POST /api/rates-karigar`
- `GET|POST /api/payments-shops`
- `GET|POST /api/payments-karigar`
- `GET|POST|PATCH|DELETE /api/users`
- `GET|POST /api/settings`

## Business Rules Enforced
- Cutting must be done before karigar assignment.
- Admin is the only role that can assign karigar.
- Shop and karigar remain restricted to own data only.
- Suit bundle billing rules remain unchanged.
- Order status auto-updates from piece progress.

## Deployment
### Vercel
Use root deployment with `vercel.json`.

### Netlify
`netlify.toml` is set with functions directory `api/`.
