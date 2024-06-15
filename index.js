require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const OTP = require('./models/OTP.js');
const app = express();
const port = process.env.PORT || 5000;
const mongoose = require('mongoose');
const useragent = require('express-useragent');
const { body, validationResult } = require('express-validator');
const i18n = require('./i18n'); 
const i18nextMiddleware = require('i18next-http-middleware');
const path = require('path');
const UAParser = require('ua-parser-js'); 
const speakeasy = require('speakeasy'); 

app.use('/locales', express.static(path.join(__dirname, 'public/locales')));

const allowedOrigins = [
  'http://localhost:3000',
  'https://twitter-clones-tan.vercel.app',
  'https://backwits.onrender.com'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
};

app.use(cors(corsOptions));


app.use(express.json());

const uri = process.env.MONGODB_URI;
mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000, 
  socketTimeoutMS: 45000 
});

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
const plans = {
  free: {
    priceId: null,
    name: 'Free Plan',
    postingLimit: 10,
  },
  monthly: {
    priceId: process.env.STRIPE_MONTHLY_PRICE_ID,
    name: 'Monthly Plan',
    postingLimit: 100,
  },
  yearly: {
    priceId: process.env.STRIPE_YEARLY_PRICE_ID,
    name: 'Yearly Plan',
    postingLimit: 1200,
  },
};
const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASSWORD 
  }
});
const generateOTP = () => {
  const otpLength = 6;
  let otp = '';
  for (let i = 0; i < otpLength; i++) {
    otp += Math.floor(Math.random() * 10);  }
  return otp;
};

const storeOTP = async (email, otp) => {
  try {
    const otpCollection = client.db("database").collection("otp"); 
    await otpCollection.insertOne({ email, otp });
    console.log('Stored OTP in database:', otp);
    return true; 
    } catch (error) {
    console.error('Error storing OTP in database:', error);
    return false; 
    }
};

const sendOTP = async (email, otp) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'OTP Verification',
    text: `Your OTP for Twitter clone verification is: ${otp}`
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};
const extractDeviceInfo = (req, res, next) => {
    const parser = new UAParser();
    const ua = req.headers['user-agent'];
    const result = parser.setUA(ua).getResult();
    req.deviceInfo = {
        browser: result.browser.name,
        os: result.os.name,
        device: result.device.type || 'unknown',
        ip: req.ip
    };
    next();
};


async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB!");

    const postCollection = client.db("database").collection("posts"); 
    const userCollection = client.db("database").collection("users"); 
    const subscriptionCollection = client.db("database").collection("subscriptions");
    app.get('/user', async (req, res) => {
      const user = await userCollection.find().toArray();
      res.send(user);
    })
    app.get('/loggedInUser', async (req, res) => {
      const email = req.query.email;
      const user = await userCollection.find({ email: email }).toArray();
      res.send(user);
    })
    app.get('/post', async (req, res) => {
      const post = (await postCollection.find().toArray()).reverse();
      res.send(post);
    })
    app.get('/userPost', async (req, res) => {
      const email = req.query.email;
      const post = (await postCollection.find({ email: email }).toArray()).reverse();
      res.send(post);
    })

    // post
    app.post('/register', async (req, res) => {
      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.send(result);
  })
    
  
  app.post('/check-login', extractDeviceInfo, async (req, res) => {
    const { email, password } = req.body;
    const deviceInfo = req.deviceInfo;

    try {
        const user = await userCollection.findOne({ email });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.password !== password) {
            return res.status(400).json({ error: 'Invalid password' });
        }

        user.devices = user.devices || [];

        const existingDevice = user.devices.find(device =>
            device.browser === deviceInfo.browser &&
            device.os === deviceInfo.os &&
            device.device === deviceInfo.device &&
            device.ip === deviceInfo.ip
        );

        if (!existingDevice) {
            const newOtp = speakeasy.totp({
                secret: process.env.OTP_SECRET,
                encoding: 'base32'
            });

            await userCollection.updateOne(
                { email },
                { $set: { otp: newOtp, otpCreatedAt: new Date() } }
            );

            const transporter = nodemailer.createTransport({
                service: 'Gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASSWORD
                }
            });

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Your OTP Code',
                text: `Your OTP code is ${newOtp}`
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    return res.status(500).send(error.toString());
                }
                return res.status(200).json({ message: 'OTP sent, please check your email' });
            });

            return;
        }

        if (deviceInfo.device.toLowerCase().includes('mobile')) {
            const currentHour = new Date().getHours();
            if (currentHour < 6 || currentHour > 18) {
                return res.status(403).json({ error: 'Access restricted during this time for mobile devices' });
            }
        }

        res.status(200).json({ success: true, message: 'Login successful', redirect: '/home/feed' });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


    app.post('/post', async (req, res) => {
      const post = req.body;
      const result = await postCollection.insertOne(post);
      res.send(result);
    })
    app.patch('/userUpdates/:email', async (req, res) => {
      const filter = req.params;
      const profile = req.body;
      const options = { upsert: true };
      const updateDoc = { $set: profile };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      res.send(result)
    })

    app.post('/subscribe', async (req, res) => {
      const { email, name, plan, paymentMethodId } = req.body;

      try {
        let user = await userCollection.findOne({ email });

        if (!user) {
          user = {
            email,
            name,
            plan,
            stripeCustomerId: null,
            subscriptionId: null,
          };

          await userCollection.insertOne(user);
        }

        if (plan === 'free') {
          const subscription = {
            email,
            name,
            plan,
            stripeCustomerId: null,
            subscriptionId: null,
          };

          await subscriptionCollection.insertOne(subscription);
        } else {
          const customer = await stripe.customers.create({
            email,
            payment_method: paymentMethodId,
            invoice_settings: { default_payment_method: paymentMethodId },
          });

          const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: plans[plan].priceId }],
            expand: ['latest_invoice.payment_intent'],
          });

          const subscriptionData = {
            email,
            name,
            plan,
            stripeCustomerId: customer.id,
            subscriptionId: subscription.id,
          };

          await subscriptionCollection.insertOne(subscriptionData);

          await userCollection.updateOne(
            { email },
            { $set: { stripeCustomerId: customer.id, subscriptionId: subscription.id, plan } }
          );
        }

        res.status(200).json({ success: true, message: 'Subscription successful' });
      } catch (error) {
        console.error('Error creating subscription:', error);
        res.status(500).json({ error: 'Subscription creation failed' });
      }
    });

  } catch (error) {
    console.log(error);
  }
}

run().catch(console.dir);
app.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const otp = generateOTP();
   // console.log('Generated OTP:', otp); 
    const otpStored = await storeOTP(email, otp); 
//    console.log('OTP stored in database:', otpStored); 
    if (!otpStored) {
      throw new Error('Error generating OTP');
    }
    const otpSent = await sendOTP(email, otp);
    console.log('OTP sent via email:', otpSent); 
    if (!otpSent) {
      throw new Error('Error sending OTP');
    }
    res.status(200).send({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).send({ message: 'Error sending OTP' });
  }
});

app.post('/verify-otp', async (req, res) => {
  const { email, otp, lng } = req.body;

  try {
    const otpCollection = client.db("database").collection("otp"); 
    const storedOTP = await otpCollection.findOne({ email: email }, { sort: { _id: -1 } });

    if (!storedOTP) {
      console.log('No OTP found for email:', email);
      return res.status(404).json({ success: false, message: 'OTP not found' });
    }

    if (storedOTP.otp === otp) {
      const language = lng || 'en'; 
      res.status(200).json({ success: true, language });
    }
     else {
      console.log('Invalid OTP for email:', email);
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});
app.get('/home/feed', (req, res) => {
  const lang = req.query.lang || 'en';
  i18n.changeLanguage(lang, (err, t) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.send(t('welcome'));
  });
});
app.get('/', (req, res) => {
  res.send('Hello from Twitter Clone!');
});

app.listen(port, () => {
  console.log(`Twitter clone is listening on port ${port}`);
});
