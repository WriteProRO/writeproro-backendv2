# WriteProRO Backend

Secure backend proxy for WriteProRO OpenAI integration.

## Setup Instructions

### 1. Install Dependencies
```bash
cd writeproro-backend
npm install
```

### 2. Environment Configuration
1. Copy `.env.example` to `.env`
2. Add your OpenAI API key:
```bash
cp .env.example .env
```

Edit `.env` file:
```
OPENAI_API_KEY=sk-your-actual-openai-api-key-here
PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=https://yourusername.github.io,http://localhost:3000
```

### 3. Run the Server

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

### 4. Update Frontend
Update your WriteProRO frontend to point to this backend:
- Local testing: `http://localhost:3001`
- Production: Your deployed backend URL

## Deployment Options

### Option A: Railway (Recommended)
1. Sign up at railway.app
2. Connect your GitHub repo
3. Add environment variables in Railway dashboard
4. Deploy automatically

### Option B: Render
1. Sign up at render.com
2. Create new Web Service
3. Connect your GitHub repo
4. Add environment variables
5. Deploy

### Option C: Vercel
1. Sign up at vercel.com
2. Import your project
3. Add environment variables
4. Deploy

## Security Features
- Rate limiting (100 requests per 15 minutes)
- CORS protection
- Helmet security headers
- API key server-side only
- Input validation
- Error handling

## API Endpoints

### POST `/api/generate-documentation`
Generate automotive service documentation using GPT-4.

**Request Body:**
```json
{
  "vin": "1HGBH41JXMN109186",
  "system": "Engine",
  "dtcCodes": "P0301, P0302",
  "techNotes": "Customer reports engine misfiring...",
  "dealership": "Bob King Buick GMC",
  "technician": "John Smith"
}
```

**Response:**
```json
{
  "success": true,
  "content": "Generated documentation...",
  "metadata": {
    "model": "gpt-4",
    "usage": {...},
    "timestamp": "2025-07-28T..."
  }
}
```

### GET `/health`
Health check endpoint.

## Environment Variables
- `OPENAI_API_KEY`: Your OpenAI API key (required)
- `PORT`: Server port (default: 3001)
- `NODE_ENV`: Environment (development/production)
- `ALLOWED_ORIGINS`: Comma-separated list of allowed frontend URLs
- `API_RATE_LIMIT`: Requests per 15-minute window (default: 100)
- `CUSTOM_SYSTEM_PROMPT`: Optional custom system prompt for GPT-4