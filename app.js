const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();
const { distance } = require('fastest-levenshtein');

// Set up multer for file uploads
const storage = multer.diskStorage({ // Changed to diskStorage for proper configuration
    destination: (req, file, cb) => {
        cb(null, 'public/images'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

const connection = mysql.createConnection({
    host: 'c237-all.mysql.database.azure.com',
    user: 'c237admin',
    password: 'c2372025!',
    database: 'pet', // Database name
    port: 3306,  
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
});

// Set up view engine
app.set('view engine', 'ejs');
// enable static files
app.use(express.static('public'));
// enable form processing
app.use(express.urlencoded({
    extended: false
}));

// Session Middleware
app.use(session({
    secret: 'secret', // Session secret
    resave: false,
    saveUninitialized: true,
    // Session expires after 1 week of inactivity
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(flash());

// Middleware to check if user is logged in
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    }
};

// Middleware to check if user is admin
const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'staff') { // Added req.session.user check
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/purchase'); // Redirect to purchase for non-admins
    }
};

// Middleware for form validation
const validateRegistration = (req, res, next) => {
    const { username, password, role } = req.body;

    // Corrected contact validation to check for empty string or null
    if (!username|| !password || !role) {
        return res.status(400).send('All fields are required.');
    }

    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 or more characters long');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }
    next();
};

// Define routes
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});

app.get('/managePets', checkAuthenticated, checkAdmin, (req, res) => {
    // Fetch data from MySQL
    connection.query('SELECT * FROM pets', (error, results) => {
        if (error) throw error;
        res.render('managePets', { pets: results, user: req.session.user });
    });
});

app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

app.post('/register', validateRegistration, (req, res) => {
    const { username, password, role } = req.body;

    const sql = 'INSERT INTO users (username, password, role) VALUES (?, SHA1(?), ?)';
    connection.query(sql, [username, password, role], (err, result) => {
        if (err) {
            throw err;
        }
        console.log(result);
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
});

app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Validate email and password
    if (!username || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE username = ? AND password = SHA1(?)';
    connection.query(sql, [username, password], (err, results) => {
        if (err) {
            throw err;
        }

        if (results.length > 0) {
            // Successful login
            req.session.user = results[0];
            req.flash('success', 'Login successful!');
            if (req.session.user.role == 'user')
                res.redirect('/purchase'); // Redirect to purchase for users
            else
                res.redirect('/managePets'); // Changed from /inventory to /managePets
        } else {
            // Invalid credentials
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    });
});

app.get('/purchase', checkAuthenticated, (req, res) => {
    // Fetch data from MySQL
    connection.query('SELECT * FROM pets', (error, results) => {
        if (error) throw error;
        res.render('buyPets', { user: req.session.user, pets: results }); // Render buyPets.ejs for '/purchase'
    });
});

/*app.post('/add-to-cart/:id', checkAuthenticated, (req, res) => {
    const petId = parseInt(req.params.id);
    const quantity = parseInt(req.body.quantity) || 1;

    connection.query('SELECT * FROM pets WHERE petId = ?', [petId], (error, results) => {
        if (error) throw error;

        if (results.length > 0) {
            const pet = results[0];

            // Initialize cart in session if not exists
            if (!req.session.cart) {
                req.session.cart = [];
            }

            // Check if pet already in cart
            const existingItem = req.session.cart.find(item => item.petId === petId);
            if (existingItem) {
                existingItem.quantity += quantity;
            } else {
                req.session.cart.push({
                    petId: pet.petId,
                    petName: pet.petName,
                    price: pet.price,
                    quantity: quantity,
                    image: pet.image
                });
            }

            res.redirect('/cart');
        } else {
            res.status(404).send("Pet not found");
        }
    });
});

app.get('/cart', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    res.render('cart', { cart, user: req.session.user });
});
*/
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/addPet', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addPet', { user: req.session.user });
});

app.post('/addPet', upload.single('image'), (req, res) => { // Security Note: No authentication middleware here based on user's constraint
    // Extract pet data from the request body
    const { name, quantity, price } = req.body;
    let image;
    if (req.file) {
        image = req.file.filename; // Save only the filename
    } else {
        image = null;
    }

    const sql = 'INSERT INTO pets (petName, quantity, price, image) VALUES (?, ?, ?, ?)';
    // Insert the new pet into the database
    connection.query(sql, [name, quantity, price, image], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error adding pet:", error);
            res.status(500).send('Error adding pet');
        } else {
            // Send a success response
            res.redirect('/managePets');
        }
    });
});

// GET route - Render the pet update form
app.get('/petUpdate/:id', checkAuthenticated, checkAdmin, (req, res) => {
    const petId = req.params.id;
    const sql = 'SELECT * FROM pets WHERE petID = ?'; // Ensure correct column name

    connection.query(sql, [petId], (error, results) => {
        if (error) {
            console.error("Error fetching pet:", error);
            return res.status(500).send('Database error');
        }

        if (results.length > 0) {
            res.render('petUpdate', {
                pet: results[0],
                user: req.session.user
            });
        } else {
            res.status(404).send('Pet not found');
        }
    });
});


// POST route - Update the pet in the database
app.post('/updatePet/:id', checkAuthenticated, checkAdmin, upload.single('image'), (req, res) => {
    const petId = req.params.id;
    const { name, Age, price, breed, gender, currentImage } = req.body;
    
    const image = req.file ? req.file.filename : currentImage;

    // Match EXACT column names from your database schema
    const sql = `
        UPDATE pets 
        SET name = ?, age = ?, price = ?, image = ?, breed = ?, gender = ?
        WHERE petID = ?
    `;
    
    connection.query(sql, 
        [name, Age, price, image, breed, gender, petId], 
        (error, results) => {
            if (error) {
                console.error("Error updating pet:", error);
                req.flash('error', 'Failed to update pet');
                return res.redirect(`/petUpdate/${petId}`);
            }
            req.flash('success', 'Pet updated successfully');
            res.redirect('/managePets');
        }
    );
});

app.get('/deletePet/:id', (req, res) => { 
    const petId = req.params.id;

    connection.query('DELETE FROM pets WHERE petID = ?', [petId], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error deleting pet:", error);
            res.status(500).send('Error deleting pet');
        } else {
            // Send a success response
            res.redirect('/managePets');
        }
    });
});

//Added new GET Function for search functionlity
app.get('/search', (req, res) => {
  const searchTerm = req.query.id; 
  const sql = `SELECT * FROM pets WHERE name LIKE ?`;
  connection.query(sql, [`%${searchTerm}%`], (error, results) => {
    if (error) {
            console.error("Error searching pets:", error);
            res.status(500).send('Error searching pets');
        } else {
            // Assuming search.ejs expects a 'results' variable
            res.render('search', { results: results }) // Render search.ejs with results
        
        };
    });
});

// Added new POST route for search functionality (with Levenshtein)
app.post('/search', (req, res) => {
    const { query } = req.body;
    const searchInput = query.toLowerCase();
    const threshold = 3; // Maximum allowed difference

    // Get all pets from DB
    const sql = 'SELECT * FROM pets';
    connection.query(sql, (error, results) => {
        if (error) {
            console.error("Error searching pets:", error);
            return res.status(500).send('Error searching pets');
        }

        // Step 1: Score each pet
        const scored = results.map(pet => {
            const nameDist = distance(searchInput, pet.name.toLowerCase());
            const breedDist = distance(searchInput, pet.breed.toLowerCase());
            const minScore = Math.min(nameDist, breedDist); // Lower = better match
            return { ...pet, score: minScore };
        });

        // Step 2: Filter by threshold
        const filtered = scored
            .filter(p => p.score <= threshold)
            .sort((a, b) => a.score - b.score); // Step 3: Sort best matches first

        // Step 4: Render EJS with sorted results
        res.render('search', { results: filtered });
    });
});


//create.ejs form submission
app.post('/addItem', (req, res) => {
  const { name, breed, age, price, imageUrl } = req.body;
  
  const sql = `INSERT INTO pet (name, breed, age, price, image) VALUES ('${name}', '${breed}', '${age}', '${price}', '${image}')`;
  
  db.query(sql, [name, breed, age, price, imageUrl], (err, result) => {
    if (err) {
      console.log('Error:', err);
      res.send('Error adding pet');
    } else {
      console.log('Pet is added');
      res.send('Succesfully added pet.');
    }
  });
});

// Route to show feedback form
app.get('/feedback', checkAuthenticated, (req, res) => {
    res.render('feedback', {
        messages: req.flash('success'),
        user: req.session.user
    });
});


// Route to handle feedback submission
app.post('/feedback', checkAuthenticated, (req, res) => {
    const username = req.session.user.username;
    const comment = req.body.comment;

    const sql = 'INSERT INTO feedback (username, feedback_comment) VALUES (?, ?)';
    connection.query(sql, [username, comment], (error, results) => {
        if (error) {
            console.error('Error saving feedback:', error);
            return res.status(500).send('Error saving feedback');
        }

        req.flash('success', 'Thank you for your feedback!');
        res.redirect('feedback');
    });
});

app.get('/feedbackS', (req, res)=>{
    const sql = 'SELECT * FROM feedback';
    connection.query(sql, (err, results)=>{
        if (err) throw err;
        res.render('feedbackview', {feedback:results});
    });
});

// petguide
app.get('/petGuide', (req, res) => {
    res.render('petguide', { user: req.session.user });
});

// Add to cart functionality
// This route will handle adding items to the cart
app.post('/add-to-cart', (req, res) => {
  const { pet_id, name, price } = req.body;

  if (!req.session.cart) {
    req.session.cart = [];
  }

  // Check if pet already exists in cart
  const existingItem = req.session.cart.find(item => item.pet_id == pet_id);

  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    req.session.cart.push({
      pet_id,
      name,
      price,
      quantity: 1
    });
  }

  res.redirect('/cart'); // Redirect to cart view (you’ll create this next)
});

// Cart view route
app.get('/cart', (req, res) => {
  const cart = req.session.cart || [];
  res.render('cart', { cart });
});






const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
