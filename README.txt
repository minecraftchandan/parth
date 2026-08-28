OurMoments Birthday Surprise

This is a Vite-powered static web app. The birthday wizard is built with
vanilla JavaScript and GSAP; it does not require WordPress or Elementor at
runtime.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To create a production build:

```bash
npm run build
npm run preview
```

The app keeps its extracted resources organized in:
- `source/styles/` - page styles
- `source/scripts/` - GSAP, birthday app, and supporting runtime scripts
- `assets/favicon.png` - local browser favicon
- `assets/vendor/` - local images, music, and payment SDK files
- Google Fonts - Bricolage Grotesque, Outfit, and Shantell Sans
- `waste/` - legacy scraped assets and duplicate libraries retained outside the app

Static resources are loaded from the project. Surprise data is saved by the
local Express API in MongoDB. Create a `.env` file with:

```text
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DATABASE=birthday_surprises
PUBLIC_URL=http://localhost:3001
WEBHOOK=https://discord.com/api/webhooks/your-webhook
```

Run both the Vite frontend and API with:

```bash
npm run dev:all
```

Before creating a link, the app requests a one-time 4-digit OTP and sends it
to the configured Discord webhook. The link is created only after that OTP is
entered successfully. The API accepts the wizard payload at `POST /api/create`,
returns a private `/s/:code` link, and serves saved JSON at `GET /api/s/:code`.
Payment gateways are no longer used. The existing WhatsApp share button still
opens WhatsApp's external share URL.
