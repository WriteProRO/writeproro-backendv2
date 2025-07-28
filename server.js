const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-PASTE_YOUR_ACTUAL_API_KEY_HERE',
});

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.API_RATE_LIMIT) || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'file://',
  'https://writeproro-frontend.vercel.app',
  '*'  // Allow all origins for now - restrict in production
];
app.use(cors({
  origin: true, // Allow all origins for local HTML files
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Debug endpoint (remove after testing)
app.get('/debug', (req, res) => {
  res.json({ 
    hasApiKey: !!process.env.OPENAI_API_KEY,
    keyLength: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0,
    keyStart: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 7) : 'none',
    hardcodedFallback: process.env.OPENAI_API_KEY ? 'using env var' : 'using hardcoded'
  });
});

// Main AI generation endpoint
app.post('/api/generate-documentation', async (req, res) => {
  try {
    const { vin, system, dtcCodes, techNotes, dealership, technician } = req.body;

    // Validation
    if (!vin || !system || !techNotes) {
      return res.status(400).json({ 
        error: 'Missing required fields: vin, system, techNotes' 
      });
    }

    if (vin.length !== 17) {
      return res.status(400).json({ 
        error: 'VIN must be exactly 17 characters' 
      });
    }

    // Create the prompt for GPT-4
    const systemPrompt = process.env.CUSTOM_SYSTEM_PROMPT || `You are an expert automotive diagnostic AI trained on Gary Wellington's extensive dealership experience and real-world diagnostic patterns. You have been trained on hundreds of specific cause and correction examples from Bob King Buick GMC and automotive service best practices.

Training Examples Reference:
- P0300 Random Misfire: Usually carbon fouled plugs from short trips → Replace spark plugs, perform combustion cleaning
- P0420 Catalyst Efficiency: Typically failed catalytic converter → Replace catalytic converter, check for root cause  
- P0171/P0174 Lean Codes: Common intake manifold gasket leak → Replace intake manifold gaskets, clean throttle body
- U0100 Lost Communication: Often corrupted module or wiring issue → Reprogram affected module, check network integrity
- HVAC No Heat: Common blend door actuator failure → Recalibrate actuator, replace if binding
- Transmission Slipping: Often low fluid or solenoid pack issues → Check fluid level, perform learn procedure
- Check Engine Light Intermittent: Typically loose gas cap or EVAP system → Inspect cap seal, smoke test EVAP system
- No Start/No Crank: Usually starter or ignition switch → Test starter draw, check ignition switch continuity

Response Requirements:
- Mirror Gary Wellington's diagnostic approach and terminology
- Use specific GM/Buick/GMC procedures and known patterns
- Reference common failure modes you've been trained on
- Keep responses concise and warranty documentation ready
- Focus on root cause identification and proven corrections
- Use dealership-standard diagnostic language`;

    const userPrompt = `Using your training on real dealership diagnostic patterns, analyze this case:

VEHICLE: ${vin}
SYSTEM: ${system} 
DTC CODES: ${dtcCodes || 'None'}
ISSUE: ${techNotes}

Based on your extensive training examples, provide:

**CAUSE:**
[Specific root cause using trained diagnostic patterns]

**CORRECTION:**
[Step-by-step procedure based on proven successful repairs]

**VERIFICATION:**
[Confirm repair success using standard procedures]

Apply your trained knowledge of common failure patterns and proven correction procedures. Keep under 250 words.`;

    // Call OpenAI GPT-4
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 350, // Focused on concise cause/correction
      temperature: 0.1, // Very low temperature for consistent, specific responses
    });

    const generatedContent = completion.choices[0].message.content;

    // Log the request for monitoring (without sensitive data)
    console.log(`[${new Date().toISOString()}] Documentation generated for VIN: ${vin.slice(-4)}, System: ${system}`);

    res.json({
      success: true,
      content: generatedContent,
      metadata: {
        model: completion.model,
        usage: completion.usage,
        timestamp: new Date().toISOString(),
        system: system,
        vin_last_4: vin.slice(-4)
      }
    });

  } catch (error) {
    console.error('OpenAI API Error:', error);
    
    // Handle different types of errors
    if (error.code === 'insufficient_quota') {
      return res.status(402).json({ 
        error: 'OpenAI API quota exceeded. Please check your billing.' 
      });
    }
    
    if (error.code === 'invalid_api_key') {
      return res.status(401).json({ 
        error: 'Invalid OpenAI API key configuration.' 
      });
    }

    res.status(500).json({ 
      error: 'Internal server error during AI generation',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`WriteProRO Backend Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`OpenAI API Key configured: ${process.env.OPENAI_API_KEY ? 'Yes' : 'No'}`);
  if (process.env.OPENAI_API_KEY) {
    console.log(`API Key starts with: ${process.env.OPENAI_API_KEY.substring(0, 7)}...`);
  }
});

module.exports = app;