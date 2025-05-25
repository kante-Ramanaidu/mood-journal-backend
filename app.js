require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');

// Uncomment if Node version < 18
// const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 5000;

const isProduction = process.env.NODE_ENV === 'production';

const corsOptions = {
  origin: isProduction
    ? 'https://front-end-virid-theta.vercel.app'
    : '*',
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('Mood Journal Backend is running!');
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

pool.connect()
  .then(() => console.log('✅ Connected to PostgreSQL'))
  .catch(err => {
    console.error('❌ DB connection error:', err.message);
    process.exit(1);
  });

// -------------------- SIGNUP --------------------
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: 'Email and password required' });

  try {
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0)
      return res.status(400).json({ message: 'User already exists' });

    await pool.query('INSERT INTO users (email, password) VALUES ($1, $2)', [email, password]);
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// -------------------- LOGIN --------------------
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: 'Email and password required' });

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0)
      return res.status(400).json({ message: 'User not found. Please sign up first.' });

    const user = userRes.rows[0];
    if (user.password !== password)
      return res.status(401).json({ message: 'Incorrect password' });

    res.status(200).json({ message: 'Login successful' });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// -------------------- SAVE MOOD --------------------
app.post('/api/mood', async (req, res) => {
  const { email, mood, triggers } = req.body;

  if (!email || !mood)
    return res.status(400).json({ message: 'Email and mood are required' });

  try {
    await pool.query(
      'INSERT INTO moods (email, mood, triggers, created_at) VALUES ($1, $2, $3, NOW())',
      [email, mood, triggers || []]
    );
    res.status(201).json({ message: 'Mood saved successfully' });
  } catch (err) {
    console.error('Error saving mood:', err.message);
    res.status(500).json({ message: 'Error saving mood' });
  }
});

// -------------------- GET MOOD HISTORY --------------------
app.get('/api/mood/history', async (req, res) => {
  const { email, days, triggers } = req.query;

  if (!email || !days)
    return res.status(400).json({ message: 'Missing email or days parameter' });

  const daysInt = parseInt(days);
  if (isNaN(daysInt) || daysInt <= 0 || daysInt > 365)
    return res.status(400).json({ message: 'Invalid days parameter. Must be between 1 and 365.' });

  let triggersArray = [];
  if (triggers) {
    triggersArray = triggers.split(',').map(t => t.trim()).filter(t => t.length > 0);
  }

  try {
    let queryText = `
      SELECT mood, triggers, created_at
      FROM moods
      WHERE email = $1
        AND created_at >= NOW() - INTERVAL '${daysInt} days'
    `;
    const queryParams = [email];

    if (triggersArray.length > 0) {
      queryText += ` AND triggers && $2::text[]`;
      queryParams.push(triggersArray);
    }

    queryText += ' ORDER BY created_at DESC';

    const result = await pool.query(queryText, queryParams);

    const moodHistory = result.rows;

    const triggerCounts = {};
    moodHistory.forEach(entry => {
      (entry.triggers || []).forEach(trigger => {
        triggerCounts[trigger] = (triggerCounts[trigger] || 0) + 1;
      });
    });

    res.json({ moodHistory, triggerCounts });
  } catch (err) {
    console.error('Mood history error:', err.message);
    res.status(500).json({ message: 'Server error while retrieving mood history' });
  }
});

// -------------------- FETCH SONGS FROM YOUTUBE --------------------
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

app.get('/api/songs', async (req, res) => {
  const { mood } = req.query;
  if (!mood) return res.status(400).json({ message: 'Mood is required' });

  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(
    mood + ' music'
  )}&key=${YOUTUBE_API_KEY}&maxResults=5`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error('YouTube API error:', data.error);
      return res.status(500).json({ message: 'YouTube API error', error: data.error });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('YouTube fetch error:', err.message);
    res.status(500).json({ message: 'Failed to fetch songs', error: err.message });
  }
});

// -------------------- FETCH QUOTES FROM QUOTABLE API --------------------
app.get('/api/quotes', async (req, res) => {
  const { mood } = req.query;
  if (!mood) return res.status(400).json({ message: 'Mood is required' });

  const moodKeywords = {
    happy: 'inspirational',
    sad: 'life',
    angry: 'anger',
    relaxed: 'peace',
  };

  const keyword = moodKeywords[mood.toLowerCase()] || 'motivational';

  try {
    const response = await fetch(`https://api.quotable.io/quotes?tags=${keyword}&limit=3`);
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return res.status(404).json({ message: 'No quotes found' });
    }

    res.status(200).json(data.results);
  } catch (err) {
    console.error('Quote fetch error:', err.message);
    res.status(500).json({ message: 'Failed to fetch quotes' });
  }
});

// -------------------- START SERVER --------------------
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});
