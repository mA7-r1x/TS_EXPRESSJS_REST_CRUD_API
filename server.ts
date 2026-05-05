import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import Database from 'better-sqlite3';
import fs from 'fs';

const app = express();
const MY_SECRET = process.env.MY_SECRET || 'emergency_backup_key';
const PORT = process.env.PORT || 3000;

app.use(fileLogger);
app.use(rateLimiter);

function fileLogger(req: Request, res: Response, next: NextFunction) {
    const time = new Date().toISOString();
    const { method, url, ip } = req;
    const logLine = `[${time}] ${ip} ${method} ${url}\n`;

    fs.appendFileSync('access.log', logLine);

    next();
}

// 1. Create/Connect to the SQLite database file
const db = new Database('main.db');

let requestCounts: Record<string, number> = {};
function rateLimiter(req: any, res: any, next: any) {
    let userIP = req.ip || 'unknown'; // fallback just in case
    if (requestCounts[userIP]) {
        requestCounts[userIP]++;
    } else {
        requestCounts[userIP] = 1
    }

    if (requestCounts[userIP] > 10) {
        return res.status(429).json({ error: "Too many requests. Try again later." });
    }
    next(); // functions like an } else { block
}


// 2. Create the table if it doesn't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    text TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// 3. Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));


function checkSecret(req: Request, res: Response, next: NextFunction) {
    if (req.headers['x-api-key'] !== MY_SECRET) {
        return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
    } else {
        next()
    }
}


// 4. The POST Route
app.post('/submit', (req, res, next) => {
    try {
        const startTime = Date.now();
        const message = req.body.message;

        // Validation
        if (!message) {
            return res.status(400).json({ error: "Message is required" });
        }

        
        // Save to SQL Database
        const stmt = db.prepare('INSERT INTO messages (text) VALUES (?)');
        const info = stmt.run(message);

        // Success Response
        res.json({
            status: "Success",
            id: info.lastInsertRowid,
            received: message
        });

        // Logging (The logic we built earlier)
        const duration = Date.now() - startTime;
        console.log(`[${req.method}] ${req.url} | Status: ${res.statusCode} | Time: ${duration}ms`);
    } catch (err) {
        next(err);
    }
});

app.delete('/messages/:id', checkSecret, (req, res, next) => {
    try {
        const ourID = Number(req.params.id)
        const statement = db.prepare('DELETE FROM messages WHERE id = ?')
        const result = statement.run(ourID)
        if (result.changes === 0) {
            return res.status(404).json({ error: "Message not found" })
        } else {
            return res.json({ message: "Successfully deleted", id: ourID })
        }
    } catch (err) {
        next(err);
    }
});

app.patch('/messages/:id', checkSecret, (req, res, next) => {
    try {
        const ID = Number(req.params.id);
        const message = req.body.message;

        if (!message || message === "") {
            return res.status(400).json({ error: 'New Message text is required' });
        }
        const statement = db.prepare('UPDATE messages SET text = ? WHERE id = ?');
        const result = statement.run(message, ID);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Message not found'});
        } else {
            return res.status(200).json({ id: ID, NewMessage: message });
        }
        } catch (err) {
        next(err);
    }
});


app.get('/search', (req, res, next) => {
    try {
        const word = req.query.q;
        if (!word) {
            return res.status(400).json({ error: "Search Query Missing" });
        }
        const searchTerm = "%" + word + "%";
        const results = db.prepare('SELECT * FROM messages WHERE text LIKE ?').all(searchTerm);
        res.json(results);
    } catch (err) {
        next(err);
    }
 })



app.get('/messages/:id', (req, res, next) => {
    try {
        const ourID = Number(req.params.id)
        const statement = db.prepare('SELECT * FROM messages WHERE id = ?');
        // This stores the actual database row
        const result = statement.get(ourID)
    
        if (!result) {
            return res.status(404).json({ error: "Message not found" });
        } else {
            return res.json(result)
        }
    } catch (err) {
        next(err);
    }
})

function globalErrorHandling(err: any, req: any, res: any, next: any) {
    console.error(err.stack)
    res.status(500).json({ error: "Internal Server Error" });
}

app.use(globalErrorHandling);

// 5. Start the Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

setInterval(() => {
    requestCounts = {};
    console.log("Rate limit counts reset.");
}, 60000);