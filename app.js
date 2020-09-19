const path = require('path');
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const yup = require('yup');
const monk = require('monk');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const { nanoid } = require('nanoid');
const Discord = require('discord.js');
const client = new Discord.Client();
var http = require('follow-redirects').http;
var fs = require('fs');

require('dotenv').config();

const db = monk(process.env.MONGODB_URI);
const urls = db.get('urls');
urls.createIndex({ slug: 1 }, { unique: true });

const app = express();
app.enable('trust proxy');

app.use(helmet());
app.use(morgan('common'));
app.use(express.json());
app.use(express.static('./public'));

app.get('/:id', async (req, res, next) => {
    const { id: slug } = req.params;
    try {
        const url = await urls.findOne({ slug });
        if (url) {
            return res.redirect(url.url);
        }
        return res.status(404);
    } catch (error) {
        return res.status(404);
    }
});

const schema = yup.object().shape({
    slug: yup.string().trim().matches(/^[\w\-]+$/i),
    url: yup.string().trim().url().required(),
});

app.post('/url', slowDown({
    windowMs: 30 * 1000,
    delayAfter: 1,
    delayMs: 500,
}), rateLimit({
    windowMs: 30 * 1000,
    max: 1,
}), async (req, res, next) => {
    let { slug, url } = req.body;
    try {
        await schema.validate({
            slug,
            url,
        });
        if (url.includes('cdg.sh')) {
            throw new Error('Stop it. 🛑');
        }
        if (!slug) {
            slug = nanoid(parseInt(process.env.SLUG_LENGTH));
        } else {
            const existing = await urls.findOne({ slug });
            if (existing) {
                throw new Error('Slug in use. 🍔');
            }
        }
        slug = slug.toLowerCase();
        const newUrl = {
            url,
            slug,
        };
        const created = await urls.insert(newUrl);
        res.json(created);
    } catch (error) {
        next(error);
    }
});

app.use((req, res, next) => {
    res.status(404);
});

app.use((error, req, res, next) => {
    if (error.status) {
        res.status(error.status);
    } else {
        res.status(500);
    }
    res.json({
        message: error.message,
        stack: process.env.NODE_ENV === 'production' ? '🥞' : error.stack,
    });
});

const port = process.env.PORT || 1337;
app.listen(port, () => {
    console.log(`Listening at http://localhost:${port}`);
});
client.once('ready', () => {
    console.log("Discord Bot Online");
});
client.on('message', message => {
    const prefix = '!'
    if(!message.content.startsWith(prefix) || message.author.bot) return;
    const args = message.content.slice(prefix.length).trim().split(' ');
    const command = args.shift().toLowerCase();
    if(message.author.roles.cache.has(process.env.ROLE_LOCK)) {
        return message.channel.send('You must be a higher rank to use this command.')
    }
    if(command == 'shorten') {
        if(!args.length) {
            return message.channel.send('Please provide a URL to shorten. ex. `!shorten knightsofacademia.org (slug)`')
        }
        let url = args[0];
        let slug = args[1];
        var options = {
            'method': 'POST',
            'hostname': 'localhost',
            'port': 1337,
            'path': '/url',
            'headers': {
                'Content-Type': 'application/json'
            },
            'maxRedirects': 20
        };
        var req = http.request(options, function (res) {
            var chunks = [];
            
            res.on("data", function (chunk) {
                chunks.push(chunk);
            });
            
            res.on("end", function (chunk) {
                var body = Buffer.concat(chunks);
                var bodyOutput = body.toString()
                let slug = JSON.parse(bodyOutput).slug
                message.channel.send(`http://koa.gg/${slug}`);
            });
            
            res.on("error", function (error) {
                console.error(error);
            });
        });  
        var postData = JSON.stringify({"url":url,"slug":slug});
        req.write(postData);
        req.end();
        message.delete(1500); 
    }
})
client.login(process.env.DISCORD_TOKEN);
