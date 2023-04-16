const express = require("express");
const path = require("path");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

const convertDBServerObjectToResponseObject1 = (dbObject) => {
  return {
    username: dbObject.username,
    tweet: dbObject.tweet,
    name: dbObject.name,
    likes: dbObject.likes,
    replies: dbObject.replies,
    dateTime: dbObject.date_time,
  };
};

//Register User API 1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * 
  FROM user 
  WHERE 
    username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const addUserQuery = `
        INSERT INTO user (username, password, name, gender)
        VALUES (
            '${username}',
            '${hashedPassword}',
            '${name}',
            '${gender}'
        );`;
      await db.run(addUserQuery);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//Login User API 2
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `
    SELECT * 
    FROM user 
    WHERE 
        username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatch = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatch) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//Get tweets APT 3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let { username } = request;
  const selectUserQuery = `
    SELECT * 
    FROM user 
    WHERE 
        username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  const selectLatestTweetQuery = `
  SELECT
user.username, tweet.tweet, tweet.date_time
FROM
follower
INNER JOIN tweet
ON follower.following_user_id = tweet.user_id
INNER JOIN user
ON tweet.user_id = user.user_id
WHERE
follower.follower_user_id = ${dbUser.user_id}
ORDER BY
tweet.date_time DESC
LIMIT 4`;
  const latestTweet = await db.all(selectLatestTweetQuery);
  response.send(
    latestTweet.map((eachObject) =>
      convertDBServerObjectToResponseObject1(eachObject)
    )
  );
});

//Get user following API 4
app.get("/user/following/", authenticateToken, async (request, response) => {
  let { username } = request;
  const selectUserQuery = `
    SELECT * 
    FROM user 
    WHERE 
        username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  const selectNameQuery = `
  SELECT user.name
  FROM follower INNER JOIN user
  ON follower.follower_user_id = user.user_id;
  WHERE 
    follower.following_user_id = ${dbUser.user_id};`;
  const arrayName = await db.all(selectNameQuery);
  response.send(
    arrayName.map((eachObject) =>
      convertDBServerObjectToResponseObject1(eachObject)
    )
  );
});

//Get user followers API 5
app.get("/user/followers/", authenticateToken, async (request, response) => {
  let { username } = request;
  const selectNameQuery = `
  SELECT user.name
  FROM follower INNER JOIN user
  ON follower.follower_user_id = user.user_id;
  WHERE 
    follower.following_user_id = (
        SELECT user_id
        FROM user
        WHERE username = '${username}'
    )`;
  const arrayName = await db.all(selectNameQuery);
  response.send(
    arrayName.map((eachObject) =>
      convertDBServerObjectToResponseObject1(eachObject)
    )
  );
});

//Get user tweets API 6
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  let { username } = request;
  const { tweetId } = request.params;
  const getUserQuery = `
  SELECT *
   FROM (follower INNER JOIN tweet 
  ON follower.following_user_id = tweet.user_id) AS T
  INNER JOIN user ON user.user_id = T.user_id
  WHERE tweet.user_id IN (
        SELECT following_user_id
        FROM follower
        WHERE follower_user_id = (
          SELECT user_id
          FROM user
          WHERE username = '${username}'
        )
      ) AND T.tweet_id = ${tweetId}`;
  const validUser = await db.get(getUserQuery);
  const getTweetQuery = `
    SELECT T.tweet, COUNT(like.like_id) AS likes, COUNT(T.reply) AS replies, tweet.date_time
    FROM (tweet INNER JOIN reply 
    ON tweet.tweet_id = reply.tweet_id) AS T
    INNER JOIN like ON T.tweet_id = like.tweet_id
    WHERE T.tweet_id = ${tweetId};`;
  if (validUser === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const tweet = await db.get(getTweetQuery);
    response.send(convertDBServerObjectToResponseObject1(tweet));
  }
});

//Get user likes API 7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    let { username } = request;
    const { tweetId } = request.params;
    const getUserQuery = `
  SELECT *
   FROM (follower INNER JOIN tweet 
  ON follower.following_user_id = tweet.user_id) AS T
  INNER JOIN user ON user.user_id = T.user_id
  WHERE tweet.user_id IN (
        SELECT following_user_id
        FROM follower
        WHERE follower_user_id = (
          SELECT user_id
          FROM user
          WHERE username = '${username}'
        )
      ) AND T.tweet_id = ${tweetId}`;
    const validUser = await db.get(getUserQuery);
    if (validUser === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getLikedUserQuery = `
    SELECT (
        SELECT username
        FROM user INNER JOIN like ON user.user_id = like.user_id
    ) AS likes
    FROM tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE like.tweet_id = ${tweetId};`;
      const likedUsers = await db.all(getLikedUserQuery);
      response.send(likedUsers);
    }
  }
);

//Get user replies API 8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    let { username } = request;
    const { tweetId } = request.params;
    const getUserQuery = `
  SELECT *
   FROM (follower INNER JOIN tweet 
  ON follower.following_user_id = tweet.user_id) AS T
  INNER JOIN user ON user.user_id = T.user_id
  WHERE tweet.user_id IN (
        SELECT following_user_id
        FROM follower
        WHERE follower_user_id = (
          SELECT user_id
          FROM user
          WHERE username = '${username}'
        )
      ) AND T.tweet_id = ${tweetId}`;
    const validUser = await db.get(getUserQuery);
    if (validUser === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getRepliesUserQuery = `
        SELECT
        (
            SELECT name
            FROM reply INNER JOIN user ON
            reply.user_id = user.user_id
        ) AS name,
        reply
        FROM reply INNER JOIN tweet ON
            reply.tweet_id = tweet.tweet_id
        WHERE reply.tweet_id = ${tweetId};`;
      const userReplies = await db.all(getRepliesUserQuery);
      response.send(userReplies);
    }
  }
);

//Get all tweet of user API 9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getAllTweetsQuery = `
    SELECT T.tweet, COUNT(T.like_id) AS likes, COUNT(reply.user_id), tweet.date_time
    FROM (tweet INNER JOIN like
    ON tweet.tweet_id = like.tweet_id) AS T
    INNER JOIN reply ON T.tweet_id = reply.tweet_id
    WHERE T.user_id = (
        SELECT user_id
        FROM user
        WHERE username = '${username}'
    );`;
  const tweets = await db.all(getAllTweetsQuery);
  response.send(tweets);
});

//Post tweet API 10
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const postTweetQuery = `
    INSERT INTO tweet(tweet)
    VALUES(
        '${tweet}')`;
  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

//Delete tweet API 11
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    let { username } = request;
    const { tweetId } = request.params;
    const selectUserQuery = `
    SELECT * 
    FROM user 
    WHERE 
        username = '${username}';`;
    const dbUser = await db.get(selectUserQuery);
    const getUserQuery = `
    SELECT *
    FROM
        tweet 
    WHERE
    user_id = ${dbUser.user_id} AND tweet_id = ${tweetId}`;
    const validUser = await db.get(getUserQuery);
    if (validUser === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `
        DELETE FROM tweet
        WHERE tweet_id = ${tweetId};`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
