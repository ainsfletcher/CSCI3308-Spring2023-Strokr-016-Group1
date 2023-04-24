
const express = require('express'); // To build an application server or API
const app = express();
// const pgp = require('pg-promise')(); // To connect to the Postgres DB from the node server
const bodyParser = require('body-parser');
const session = require('express-session'); // To set the session object. To store or access session data, use the `req.session`, which is (generally) serialized as JSON by the store.
const bcrypt = require('bcrypt'); //  To hash passwords
const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part B.
const db = require("./resources/js/dbConnection");


// // database configuration
// const dbConfig = {
//   host: 'db', // the database server
//   port: 5432, // the database port
//   database: process.env.POSTGRES_DB, // the database name
//   user: process.env.POSTGRES_USER, // the user account to connect with
//   password: process.env.POSTGRES_PASSWORD, // the password of the user account
// };

// const db = pgp(dbConfig);

// // test your database
// db.connect()
//   .then(obj => {
//     console.log('Database connection successful'); // you can view this message in the docker compose logs
//     obj.done(); // success, release the connection;
//   })
//   .catch(error => {
//     console.log('ERROR:', error.message || error);
//   });

app.set('view engine', 'ejs'); // set the view engine to EJS
app.use(bodyParser.json()); // specify the usage of JSON for parsing request body.

// initialize session variables
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);


app.get("/", (req, res) => {
    res.redirect("/login");
  });


  app.get("/register", (req, res) => {
    res.render("pages/register");
  });

  app.get("/weather", (req, res) => {
    res.render("pages/weather");
  });

  app.get("/login", (req, res) => {
    res.render("pages/login");
  });

  app.get("/logout", (req, res) => {
    req.session.destroy();
    res.render('pages/login', {
      message: "Logged out successfully!!!"
    });
  });

  app.post('/register', async (req, res) => {
    if(!req.body.username || !req.body.password){
      return res.status(400).render('pages/register', {
        message: "Missing username or password"
      });
    }
    let infoId = "Nothin";
    let userId = "Nothin";
    const hash = await bcrypt.hash(req.body.password, 10);
    const query = `INSERT INTO users (username, password) VALUES ($1, $2) returning *;`;
    const infoQuery = `INSERT INTO user_info (name, age, handicap, home_course, movement, bio) VALUES ('blank', 0.0, 0, 'blank', 'blank', 'blank') returning *;`;
    const relationalQuery = `INSERT INTO user_to_info (user_id, info_id) VALUES ($1, $2) returning * ;`;

    try {
      infoId = await db.one(infoQuery);
      // console.log("Your info id - " + infoId.info_id);
    } catch (error) {
      return console.log("Create user info query error - "+ error);
    }

    try{
      userId = await db.one(query, [req.body.username, hash]);
      // console.log(userId.user_id);
      // console.log("Info id!! - " + infoId.info_id);
      await db.one(relationalQuery, [userId.user_id, infoId.info_id]);
      return res.status(200).redirect('/login');
    } catch(error){
      console.log("DB error - " + error);
      return res.status(400).render('pages/register', {
        message: "Username already exists"
      });
    }

  });

  app.post('/login', async (req, res) => {
    if(!req.body.username || !req.body.password){
      return res.status(400).render('pages/login', {
        message: "Missing username or password"
      });
    }
    var user = '';
    const query = `SELECT * FROM users WHERE username = $1 LIMIT 1;`;

    try{
      const data = await db.one(query,[req.body.username]);

      if (data != undefined){
        user = data;
      } else{
        console.log('user not found');
        return res.status(400);
      }
    } catch (error){
      console.log("database error - from login - most likely: register an account or double check username and password " + error);
      return res.status(400).render('pages/register', {
        message: "Please register an account or double check username and password!"
      });
    }


    try{
        const match = await bcrypt.compare(req.body.password, user.password);
        if(match){
            req.session.user = user;
            req.session.save();

            return res.status(200).redirect('/profile');
        } else {
          res.status(200).render("pages/login", {
            message: "Wrong password!"
          })
        }

    }
    catch(error){
        console.log("error: " + error);
        res.status(400).redirect('pages/register', {
          message: "Please register an account or double check username and password!"
        });
        
    }

  });

  // Displays all users in the database except for the current user
  const displayUsers = async (user) => {
    const info_id = await userToInfoDB(user);
    const otherUserQuery = `SELECT * FROM user_info WHERE info_id != $1 ;`;
    return await db.any(otherUserQuery,[info_id]);
  };

  const userToInfoDB = async (user) => {
    try{
        const query = `SELECT user_id FROM users WHERE username = $1 ;`;
        const uID = await db.one(query, [user.username]);

        const relationQuery = `SELECT info_id FROM user_to_info WHERE user_id = $1`;
        return (await db.one(relationQuery, [uID.user_id])).info_id;
    } catch (error){
        return console.log("ERROR from userToInfoDB - " + error);
    }
}

  const infoToUserDB = async (info) => {
    try{
        const query = `SELECT info_id FROM user_info WHERE info_id = $1 ;`;
        const infoID = await db.one(query, [info.info_id]);

        const relationQuery = `SELECT user_id FROM user_to_info WHERE info_id = $1`;
        const uID = (await db.one(relationQuery, [infoID.info_id])).user_id;

        const uQuery = `SELECT * FROM users WHERE user_id = $1 ;`;
        return (await db.one(uQuery, [uID]));
    } catch (error){
        return console.log("ERROR from userToInfoDB - " + error);
    }
  }

  app.post("/updateInfo", async (req,res) => {
    // Check to make sure req.session.user exists - otherwise redirect to login and yell curse words
    if(!req.session.user){
      return res.render('pages/login',{
        message: "login to update info"
      });
    }

    const user = req.session.user;
    const info_id = await userToInfoDB(user);

    const query = `SELECT * FROM user_info WHERE info_id = $1`;

    const results = await db.one(query, [info_id]);

    // check if info exists (not undefined) else render page(route is below) w/ message "Please fill all boxes"
    const data = req.body;
    if(!data.name || !data.handicap || !data.age || !data.home_course || !data.movement || !data.bio ) {
      return res.render('pages/profile', {
        message: "Please complete your profile by filling out all information!",
        results: results
      });
    };


    // query to alter at user_id if found (they cant even access this page if they arent logged in)

    // const relationalQuery = `SELECT info_id `
    const alterQuery = `UPDATE user_info SET name = $1, handicap = $2, age = $3, home_course = $4, movement = $5, bio = $6 WHERE info_id = $7 RETURNING * ;`;

    try {
      // use second query to update db
      // render new profile page (route is below) with success! message and show new info
      db.one(alterQuery, [
        data.name,
        data.handicap,
        data.age,
        data.home_course,
        data.movement,
        data.bio,
        info_id
      ]);
    } catch (error) {
      console.log("Internal server error when grabbing user info for PUT req: /updateinfo - " + error);
    }
    return res.redirect("/profile");
  });

  app.get("/profile", async (req, res) => {
    if (!req.session.user) {
      console.log("No active session!");
      return res.render('pages/login', {
        message: "Please log in to view profile page!"
      });
  }

    const user = req.session.user;
    // console.log("USER" + user);
    let data = {
      name: "Blank",
      handicap: 0.0,
      age: 0,
      home_course: "Blank",
      movement: "Blank",
      bio: "Blank"
    };

    if (user) {
      const info_id = await userToInfoDB(user);

      const query = `SELECT * FROM user_info WHERE info_id = $1; `;

      data = await db.one(query, [info_id]);
    }
    res.status(200).render("pages/profile", {
      message: "Welcome! please enter your information",
      results: data
    });

  });


  app.get("/home", (req, res) => {
    if (!req.session.user) {
        console.log("No active session!");
        return res.render('pages/login', {
          message: "Please log in to view home page!"
        });
    }

    res.render('pages/home')
    
  });

  
app.get("/weatherAPI", async (req, res) => {
  const params = {
    access_key: process.env.WEATHER_API_KEY,
    query: 'Boulder',
    units: 'f'
  }
  
  axios.get('http://api.weatherstack.com/current', {params})
    .then(response => {
      console.log(response.data.current.temperature);
      res.render('pages/weatherinfo', {
        results: response.data.current
      });
      // const apiResponse = response.data;
      // console.log(`Current temperature in ${response.data.current.temperature} is ${response}℃`);
      // res.status(200).send(`Your data: ${response.data.location.name}`);
    }).catch(error => {
      console.log(error);
      return error;
    });
  
  
});

app.get("/display", async (req, res) => {
  if (!req.session.user) {
      console.log("No active session!");
      return res.render('pages/login', {
        message: "Please log in to view discover page!"
      });
  }

  try {
    const data = await displayUsers(req.session.user);

    res.status(200).render("pages/discover", {
      message: "Find your Potential Matches",
      results: data
    });

  } catch (error) {
    console.log("Error with display users " + error);
    res.status(400).render("pages/profile", {
      message: "Cant display users!"
    })
  }
});

app.post("/match_button", async (req,res) => {
  // Check to make sure req.session.user exists - otherwise redirect to login and yell curse words
  if(!req.session.user){
    return res.render('pages/login', {
      message: "Login to match with users!"
    });
  }

  const usersDisplayed = await displayUsers(req.session.user);

  // Passing data of chosen user
  const data = JSON.parse(req.body.match_user_info);
  const active_username = req.session.user.username;
  const match = req.body.is_match;

  const chosen_user = await infoToUserDB(data);

  // * Searching for previous matches *
  try {
    const query = `SELECT * FROM matches WHERE matched_username = $1 AND active_username = $2 LIMIT 1;`;
    const existing_match = await db.any(query, [active_username, chosen_user.username]);
    // If match already exists, then end desired functionality
      // If they both chose green then they are a match
      // If any one of them chose red then not a match
   // console.log("Existing match: " + existing_match);

    if (existing_match != "") {
      console.log("input match: " + (existing_match[0].is_match));
      if (existing_match[0].is_match && match == "TRUE") {
        const query = `INSERT INTO matches (matched_username, active_username, is_match, match_status) VALUES ($1, $2, $3, $4) returning * ; `;
        await db.one(query, [chosen_user.username, active_username, match, "Matched"]);
        

        return res.render('pages/discover', {
          message: "You have a match!",
          results: usersDisplayed
        })
      } else {
        const query = `INSERT INTO matches (matched_username, active_username, is_match, match_status) VALUES ($1, $2, $3, $4) returning * ; `;
        await db.one(query, [chosen_user.username, active_username, match, "Not Matched"]);
        
        
        return res.render('pages/discover', {
          message: "Not a match!",
          results: usersDisplayed
        })
      }

    }

    
  } catch (error) {
    console.log("Error with searching for previous matches " + error);
    return res.render('pages/discover', {
      message: "Error with searching for previous matches!",
      results: usersDisplayed
    })
  }


  // **********  MATCHING LOGIC **********
  // * Adding user to matches table *

  try {
    const query = `INSERT INTO matches (matched_username, active_username, is_match, match_status) VALUES ($1, $2, $3, $4) returning * ; `;
    await db.one(query, [chosen_user.username, active_username, match, "Pending"]);
  } catch (error) {
    console.log("Error with matching " + error);
    return res.render('pages/discover', {
      message: "Error with matching!",
      results: usersDisplayed
    })
  }

  // * Checking if user is in matches table *
  if (match == "TRUE") {
    return res.status(200).render("pages/discover", {
      message: "Checking if its a match :)",
      results: usersDisplayed
    });
  } else {
    return res.status(200).render("pages/discover", {
      message: "Not a match :(",
      results: usersDisplayed
    });
  }
});

app.get("/match_display", async (req,res) => {
  // Check to make sure req.session.user exists - otherwise redirect to login and yell curse words
  if(!req.session.user){
    return res.render('pages/login');
  }

  const query = `SELECT * FROM matches WHERE active_username = $1 AND is_match = true AND match_status != $2; `;

  try {
    data = await db.any(query, [req.session.user.username, "Not Matched"]);

    const matches = [];

    for (let i = 0; i < data.length; i++) {
      const info_id = await userToInfoDB({username: data[i].matched_username});
      const infoQuery = `SELECT * FROM user_info WHERE info_id = $1; `;
      const matched_user = await db.one(infoQuery, [info_id]);
      matches.unshift(matched_user);
    }

    res.status(200).render("pages/matches", {
      message: "Your Matches!",
      results: matches
    });
  } catch (error) {
    console.log("Error with display matches " + error);
    const usersDisplayed = await displayUsers(req.session.user);
    res.status(400).render("pages/discover", {
      message: "Error display matches!",
      results: usersDisplayed
    });
  }


});
  /////////LAB 11/////////////////////

  app.get('/welcome', (req, res) => {
    res.json({status: 'success', message: 'Welcome!'});
  });

  //////////////////////////////////////
//app.listen(3000);
// New commit from Ains new laptop!
try {
  module.exports = app.listen(3000);
  console.log('Server is listening on port 3000');
} catch (error) {
  console.log('Server failed - ' + error);
}
