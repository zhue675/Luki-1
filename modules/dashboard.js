const url = require("url");
const path = require("path");

const Discord = require("discord.js");

const express = require("express");
const app = express();
const moment = require("moment");
require("moment-duration-format");

const passport = require("passport");
const session = require("express-session");
const LevelStore = require("level-session-store")(session);
const Strategy = require("passport-discord").Strategy;

const helmet = require("helmet");

const md = require("marked");

const sql = require('sqlite3');
const serversDB = new sql.Database(process.cwd() + "/db/servers.db")
const usersDB = new sql.Database(process.cwd() + "/db/users.db")

module.exports = (client) => {

  const dataDir = path.resolve(`${process.cwd()}${path.sep}dashboard`);

  const templateDir = path.resolve(`${dataDir}${path.sep}templates`);

  app.use("/public", express.static(path.resolve(`${dataDir}${path.sep}public`)));

  passport.serializeUser((user, done) => {
    done(null, user);
  });
  passport.deserializeUser((obj, done) => {
    done(null, obj);
  });
  passport.use(new Strategy({
    clientID: client.appInfo.id,
    clientSecret: client.config.dashboard.oauthSecret,
    callbackURL: client.config.dashboard.callbackURL,
    scope: ["identify", "guilds"]
  },
  (accessToken, refreshToken, profile, done) => {
    process.nextTick(() => done(null, profile));
  }));

  app.use(session({
    store: new LevelStore("./data/dashboard-session/"),
    secret: client.config.dashboard.sessionSecret,
    resave: false,
    saveUninitialized: false,
  }));

  app.use(passport.initialize());
  app.use(passport.session());
  app.use(helmet());

  app.locals.domain = client.config.dashboard.domain;
  
  app.engine("html", require("ejs").renderFile);
  app.set("view engine", "html");
  var bodyParser = require("body-parser");
  app.use(bodyParser.json());      
  app.use(bodyParser.urlencoded({     
    extended: true
  })); 


  function checkAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.session.backURL = req.url;
    res.redirect("/login");
  }

  const renderTemplate = (res, req, template, data = {}) => {
    const baseData = {
      bot: client,
      path: req.path,
      user: req.isAuthenticated() ? req.user : null
    };
    res.render(path.resolve(`${templateDir}${path.sep}${template}`), Object.assign(baseData, data));
  };


  app.get("/login", (req, res, next) => {
    if (req.session.backURL) {
      req.session.backURL = req.session.backURL;
    } else if (req.headers.referer) {
      const parsed = url.parse(req.headers.referer);
      if (parsed.hostname === app.locals.domain) {
        req.session.backURL = parsed.path;
      }
    } else {
      req.session.backURL = "/";
    }
    next();
  },
  passport.authenticate("discord"));

  app.get("/callback", passport.authenticate("discord", { failureRedirect: "/autherror" }), (req, res) => {
    if (req.user.id === client.appInfo.owner.id) {
      req.session.isAdmin = true;
    } else {
      req.session.isAdmin = false;
    }
    if (req.session.backURL) {
      const url = req.session.backURL;
      req.session.backURL = null;
      res.redirect(url);
    } else {
      res.redirect("/");
    }
  });
  
  app.get("/autherror", (req, res) => {
    renderTemplate(res, req, "autherror.ejs");
  });

  app.get("/logout", function(req, res) {
    req.session.destroy(() => {
      req.logout();
      res.redirect("/"); 
    });
  });

  app.get("/", (req, res) => {
    renderTemplate(res, req, "index.ejs");
  });
  
  app.get("/stats", (req, res) => {
    const duration = moment.duration(client.uptime).format(" D [days], H [hrs], m [mins], s [secs]");
    const members = client.guilds.reduce((p, c) => p + c.memberCount, 0);
    const textChannels = client.channels.filter(c => c.type === "text").size;
    const voiceChannels = client.channels.filter(c => c.type === "voice").size;
    const guilds = client.guilds.size;
    renderTemplate(res, req, "stats.ejs", {
      stats: {
        servers: guilds,
        members: members,
        text: textChannels,
        voice: voiceChannels,
        uptime: duration,
        memoryUsage: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
        dVersion: Discord.version,
        nVersion: process.version
      }
    });
  });

  app.get("/dashboard", checkAuth, (req, res) => {
    const perms = Discord.EvaluatedPermissions;
    renderTemplate(res, req, "dashboard.ejs", {perms});
  });

  app.get("/me", checkAuth, (req, res) => {
    usersDB.get(`SELECT * FROM users WHERE id = ?`, [req.user.id], (err, row) => {
      if (err) {
        return console.error(err.message);
      }
      let rankLevel
      if (client.config.ldevelopers.includes(req.user.id) === true) {
        rankLevel = 10;
      } else if (client.config.developers.includes(req.user.id) === true) {
        rankLevel = 9;
      } else if (client.config.managers.includes(req.user.id) === true) {
        rankLevel = 8;
      } else if (client.config.hadmins.includes(req.user.id) === true) {
        rankLevel = 7;
      } else if (client.config.admins.includes(req.user.id) === true) {
        rankLevel = 6;
      } else if (client.config.hmods.includes(req.user.id) === true) {
        rankLevel = 5;
      } else if (client.config.mods.includes(req.user.id) === true) {
        rankLevel = 4
      } else if (client.config.premiump.includes(req.user.id) === true) {
        rankLevel = 3;
      } else if (client.config.premium.includes(req.user.id) === true) {
        rankLevel = 2;
      } else if (client.config.trusted.includes(req.user.id) === true){
        rankLevel = 1;
      } else {
        rankLevel = 0;
      }
      const userRank = client.config.permLevels.find(l => l.level === rankLevel).name;
      let userExp
      let userLevel
      let userTitle
      let userBio
      if (!row) {
        userExp = 1;
        userLevel = 1;
        userTitle = "No title was found";
        userBio = "No bio was found";
      } else {
        userExp = row.exp
        userLevel = row.level
        userTitle = row.title
        userBio = row.bio
      }
      renderTemplate(res, req, "/user/me.ejs", {userExp, userLevel, userTitle, userBio, userRank});
    })
  });

  app.post("/me", checkAuth, (req, res) => {
    let title = req.body.title;
    let bio = req.body.bio;
    if (!title) title = "No title was found"
    if (!bio) bio = "No bio was found"
    usersDB.get(`SELECT * FROM users WHERE id = ?`, [req.user.id], (err, row) => {
      if (err) {
        return console.error(err.message);
      }
      if (!row) {
        usersDB.run(`INSERT INTO users(id, title, bio) VALUES(?, ?, ?)`, [req.user.id, title, bio], function(err) {
          if (err) {
            return console.log(err.message);
          }
        });
      } else {
        usersDB.run(`UPDATE users SET title = ?, bio = ? WHERE id =? `, [title, bio, req.user.id], function(err) {
          if (err) {
            return console.error(err.message);
          }    
        });
      }
    });
    res.redirect("/me");
  });

  app.get("/user", (req, res) => {
    res.redirect(`/me`);
  });

  app.get("/user/:userID", (req, res) => {
    const user = client.users.get(req.params.userID);   
    if (!user) return res.status(404);
    usersDB.get(`SELECT * FROM users WHERE id = ?`, [req.params.userID], (err, row) => {
      if (err) {
        return console.error(err.message);
      }
      let rankLevel
      if (client.config.ldevelopers.includes(req.params.userID) === true) {
        rankLevel = 10;
      } else if (client.config.developers.includes(req.params.userID) === true) {
        rankLevel = 9;
      } else if (client.config.managers.includes(req.params.userID) === true) {
        rankLevel = 8;
      } else if (client.config.hadmins.includes(req.params.userID) === true) {
        rankLevel = 7;
      } else if (client.config.admins.includes(req.params.userID) === true) {
        rankLevel = 6;
      } else if (client.config.hmods.includes(req.params.userID) === true) {
        rankLevel = 5;
      } else if (client.config.mods.includes(req.params.userID) === true) {
        rankLevel = 4
      } else if (client.config.premiump.includes(req.params.userID) === true) {
        rankLevel = 3;
      } else if (client.config.premium.includes(req.params.userID) === true) {
        rankLevel = 2;
      } else if (client.config.trusted.includes(req.params.userID) === true){
        rankLevel = 1;
      } else {
        rankLevel = 0;
      }
      const userRank = client.config.permLevels.find(l => l.level === rankLevel).name;
      let userExp
      let userLevel
      let userTitle
      let userBio
      if (!row) {
        userExp = 1;
        userLevel = 1;
        userTitle = "No title was found";
        userBio = "No bio was found";
      } else {
        userExp = row.exp
        userLevel = row.level
        userTitle = row.title
        userBio = row.bio
      }
      var username = user.username
      renderTemplate(res, req, "/user/user.ejs", {userExp, userLevel, userTitle, userBio, username, userRank});
    })
  });

  app.get("/dashboard/:guildID", checkAuth, (req, res) => {
    res.redirect(`/dashboard/${req.params.guildID}/manage`);
  });


  app.get("/dashboard/:guildID/manage", checkAuth, (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    if (!guild) return res.status(404);
    const isManaged = guild && !!guild.member(req.user.id) ? guild.member(req.user.id).permissions.has("MANAGE_GUILD") : false;
    if (!isManaged && !req.session.isAdmin) res.redirect("/");
    serversDB.get(`SELECT * FROM servers WHERE id = ?`, [req.params.guildID], (err, row) => {
      if (err) {
        return console.error(err.message);
      }
      let levelValue; 
      let modLogChannel;
      let serverLogChannel;
      let prefix;
      if (!row) {
        levelValue = 0;
        modLogChannel = 'off';
        serverLogChannel = 'off';
        prefix = 'o!';
      } else {
        if (row.modlog == '') {
          modLogChannel = 'off'
        } else {
          modLogChannel = row.modlog
        }
        if (row.serverlog == '') {
          serverLogChannel = 'off'
        } else {
          serverLogChannel = row.serverlog
        }
        prefix = row.prefix;
        levelValue = row.leveling;
      }

    renderTemplate(res, req, "guild/manage.ejs", {guild, levelValue, modLogChannel, serverLogChannel, prefix});
    })
  });

  app.post("/dashboard/:guildID/manage", checkAuth, (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    if (!guild) return res.status(404);
    const isManaged = guild && !!guild.member(req.user.id) ? guild.member(req.user.id).permissions.has("MANAGE_GUILD") : false;
    if (!isManaged && !req.session.isAdmin) return res.redirect("/");
    
    let value;

    if (req.body.levels == 'on') {
      value = 1;
    } else {
      value = 0;
    }

    serversDB.get(`SELECT * FROM servers WHERE id = ?`, [req.params.guildID], (err, row) => {
      if (err) {
        return console.error(err.message);
      }

      if (!row) {
        serversDB.run(`INSERT INTO servers(id, leveling, modlog, serverlog, prefix) VALUES(?, ?, ?, ?, ?)`, [req.params.guildID, value, req.body.modlog, req.body.serverlog, req.body.prefix], function(err) {
          if (err) {
            return console.log(err.message);
          }

        });

      } else {
        serversDB.run(`UPDATE servers SET leveling = ?, modlog = ?, serverlog = ?, prefix = ? WHERE id =? `, [value,  req.body.modlog, req.body.serverlog, req.body.prefix, req.params.guildID], function(err) {
          if (err) {
            return console.error(err.message);
          }
         
        });

      }
    
    });
    res.redirect("/dashboard/"+req.params.guildID+"/manage");
  });
  

  app.get("/dashboard/:guildID/members", checkAuth, async (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    if (!guild) return res.status(404);
    renderTemplate(res, req, "guild/members.ejs", {
      guild: guild,
      members: guild.members.array()
    });
  });

  app.get("/dashboard/:guildID/members/list", checkAuth, async (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    if (!guild) return res.status(404);
    if (req.query.fetch) {
      await guild.fetchMembers();
    }
    const totals = guild.members.size;
    const start = parseInt(req.query.start, 10) || 0;
    const limit = parseInt(req.query.limit, 10) || 50;
    let members = guild.members;
    
    if (req.query.filter && req.query.filter !== "null") {
      members = members.filter(m=> {
        m = req.query.filterUser ? m.user : m;
        return m["displayName"].toLowerCase().includes(req.query.filter.toLowerCase());
      });
    }
    
    if (req.query.sortby) {
      members = members.sort((a, b) => a[req.query.sortby] > b[req.query.sortby]);
    }
    const memberArray = members.array().slice(start, start+limit);
    
    const returnObject = [];
    for (let i = 0; i < memberArray.length; i++) {
      const m = memberArray[i];
      returnObject.push({
        id: m.id,
        status: m.user.presence.status,
        bot: m.user.bot,
        username: m.user.username,
        displayName: m.displayName,
        tag: m.user.tag,
        discriminator: m.user.discriminator,
        joinedAt: m.joinedTimestamp,
        createdAt: m.user.createdTimestamp,
        highestRole: {
          hexColor: m.highestRole.hexColor
        },
        memberFor: moment.duration(Date.now() - m.joinedAt).format(" D [days], H [hrs], m [mins], s [secs]"),
        roles: m.roles.map(r=>({
          name: r.name,
          id: r.id,
          hexColor: r.hexColor
        }))
      });
    }
    res.json({
      total: totals,
      page: (start/limit)+1,
      pageof: Math.ceil(members.size / limit),
      members: returnObject
    });
  });
  
  app.get("/dashboard/:guildID/leave", checkAuth, async (req, res) => {
    const guild = client.guilds.get(req.params.guildID);
    if (!guild) return res.status(404);
    const isManaged = guild && !!guild.member(req.user.id) ? guild.member(req.user.id).permissions.has("MANAGE_GUILD") : false;
    if (!isManaged && !req.session.isAdmin) res.redirect("/");
    await guild.leave();
    res.redirect("/dashboard");
  });
  
  client.site = app.listen(client.config.dashboard.port);
};
