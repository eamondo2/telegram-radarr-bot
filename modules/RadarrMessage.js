/* global __dirname */

'use strict';

var RadarrAPI = require('sonarr-api');
var _         = require('lodash');
var moment    = require('moment');

var i18n   = require(__dirname + '/../lib/lang');
var config = require(__dirname + '/../lib/config');
var state  = require(__dirname + '/../lib/state');
var logger = require(__dirname + '/../lib/logger');
var acl    = require(__dirname + '/../lib/acl');

/*
 * initalize the class
 */
function RadarrMessage(bot, user, chat, cache) {
    this.bot      = bot;
    this.user     = user;
    this.chat     = chat;
    this.cache    = cache;
    this.adminId  = config.bot.owner;
    this.username = this.user.username || (this.user.first_name + (' ' + this.user.last_name || ''));

    this.radarr = new RadarrAPI({
        hostname : config.radarr.hostname,
        apiKey   : config.radarr.apiKey,
        port     : config.radarr.port,
        urlBase  : config.radarr.urlBase,
        ssl      : config.radarr.ssl,
        username : config.radarr.username,
        password : config.radarr.password
    });
}

function formatBytes(bytes,decimals) {
    if(bytes == 0) return '0 Bytes';
    var k = 1024,
        dm = decimals || 2,
        sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
        i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/*
 * perform commands
 */
RadarrMessage.prototype.getDiskUsage = function() {
    var self = this;
    self.radarr.get('diskspace').then(function(result) {

        _.sortBy(result, 'freeSpace');

        var response = [];

        _.forEach(result, function(n, key) {

            var usageRes = '[[ ' + n.path + ' ]] ' + (n.freeSpace / n.totalSpace) + '% ' + '| ' + formatBytes(n.freeSpace) + ' free.';
            response.push(usageRes);  

        });

        if (!response.length) {
            throw new Error(i18n.__('errorNoDisksFound'));
        }

        response.sort();

        response.unshift(i18n.__('botChatRadarrDiskUsage'));

        if (response.length > 50) {
            var splitReponse = _.chunk(response, 50);
            splitReponse.sort();
            var i = 0;
            var libraryLoop = setInterval(function () {
                var n = splitReponse[i];
                if (n === undefined) {
                    clearInterval(libraryLoop);
                } else {
                    n.sort();
                    self._sendMessage(n.join('\n'), []);
                }
                i = i + 1;
            }, 200);
        } else {
            return self._sendMessage(response.join('\n'), []);
        }

    }).catch(function(error) {
        return self._sendMessage(error);
    });
};

RadarrMessage.prototype.performLibrarySearch = function(searchText) {
    var self = this;

    var query = searchText;

    self.radarr.get('movie').then(function(result) {
        logger.info(i18n.__('logRadarrAllMovies',self.username));

        _.sortBy(result, 'title');

        var response = [];
        _.forEach(result, function(n, key) {
            var movie = '[' + n.title + '](https://www.themoviedb.org/movie/' + n.tmdbId + ')' + (n.year ? ' - _' + n.year + '_' : '');
            if (query) {
                if (n.title.search( new RegExp(query, 'i') ) !== -1) {
                    response.push(movie);
                }
            } else {
                response.push(movie);
            }
        });

        if (!response.length) {
            throw new Error(i18n.__('errorRadarrUnableToLocate', query));
        }

        response.sort();

        if (query) {
            // add title to begining of the array
            response.unshift(i18n.__('botChatRadarrMatchingResults'));
        }

        if (response.length > 50) {
            var splitReponse = _.chunk(response, 50);
            splitReponse.sort();
            var i = 0;
            var libraryLoop = setInterval(function () {
                var n = splitReponse[i];
                if (n === undefined) {
                    clearInterval(libraryLoop);
                } else {
                    n.sort();
                    self._sendMessage(n.join('\n'), []);
                }
                i = i + 1;
            }, 200);
        } else {
            return self._sendMessage(response.join('\n'), []);
        }

    }).catch(function(error) {
        return self._sendMessage(error);
    });

};

RadarrMessage.prototype.performRssSync = function() {
    var self = this;

    logger.info(i18n.__('logRadarrRSSCommandSent'));

    self.radarr.post('command', { 'name': 'RssSync' })
        .then(function() {
            logger.info('logRadarrRSSCommandExecuted', self.username);
            return self._sendMessage(i18n.__('botChatRadarrRSSCommandExecuted'));
        })
        .catch(function(error) {
            return self._sendMessage(error);
        });
};

RadarrMessage.prototype.performWantedSearch = function() {
    var self = this;

    logger.info(i18n.__('logRadarrWantedCommandSent', self.username));

    self.radarr.get('/wanted/missing', {
        'page': 1,
        'pageSize': 50,
        'sortKey': 'year',
        'sortDir': 'desc'
    })
        .then(function(wantedMovies) {
            var movieIds = [];
            _.forEach(wantedMovies.records, function(n, key) {
                movieIds.push(n.id);
            });
            return movieIds;
        })
        .then(function(movieIds) {
            self.radarr.post('command', {
                'name': 'MoviesSearch',
                'movieIds': movieIds
            })
                .then(function() {
                    logger.info(i18n.__('logRadarrWantedCommandExecuted', self.username));
                    return self._sendMessage(i18n.__('botChatRadarrWantedCommandExecuted'));
                })
                .catch(function(error) {
                    return self._sendMessage(error);
                });
        })
        .catch(function(error) {
            return self._sendMessage(error);
        });
};

RadarrMessage.prototype.performLibraryRefresh = function() {
    var self = this;

    logger.info(i18n.__('logRadarrRefreshCommandSent', self.username));

    self.radarr.post('command', {
        'name': 'RefreshMovie'
    })
        .then(function() {
            logger.info(i18n.__('logRadarrRefreshCommandExecuted', self.username));
            return self._sendMessage(i18n.__('botChatRadarrRefreshCommandExecuted'));
        })
        .catch(function(error) {
            return self._sendMessage(error);
        });
};

RadarrMessage.prototype.performCalendarSearch = function(futureDays) {
    var self = this;

    var fromDate = moment().toISOString();
    var toDate = moment().add(futureDays, 'day').toISOString();

    logger.info(i18n.__('logRadarrUpcomingCommandSent', self.username, fromDate, toDate));

    self.radarr.get('calendar', { 'start': fromDate, 'end': toDate})
        .then(function (movie) {
            if (!movie.length) {
                throw new Error(i18n.__('errorRadarrNothingInCalendar'));
            }

            var lastDate = null;
            var response = [];
            _.forEach(movie, function(n, key) {
                var done = (n.hasFile ? i18n.__('RadarrDone') : '');

                // Add an empty line to break list of multiple days
                if(lastDate != null && n.inCinemas != lastDate) response.push(' ');

                response.push('*' + n.title + '*' + ' - ' + 'In cinemas: ' + n.inCinemas + ' Physical: ' + n.physicalRelease +  done);
                lastDate = n.inCinemas;
            });

            logger.info(i18n.__('logRadarrFoundMovies', self.username, response.join(',')));

            return self._sendMessage(response.join('\n'), []);
        })
        .catch(function(error) {
            return self._sendMessage(error);
        });
};


/*
 * handle the flow of adding a new movie
 */
RadarrMessage.prototype.sendMoviesList = function(movieName) {
    var self = this;

    self.test = 'hello';

    logger.info(i18n.__('logRadarrQueryCommandSent', self.username));

    self.radarr.get('movie/lookup', { 'term': movieName }).then(function(result) {

        if (!result.length) {
            throw new Error(i18n.__('errorRadarrMovieNotFound', movieName));
        }

        var movie = result;

        logger.info(i18n.__('logRadarrUserMovieRequested', self.username, movieName));

        var movieList = [], keyboardList = [];

        movie.length = (movie.length > config.bot.maxResults ? config.bot.maxResults : movie.length);

        var response = [i18n.__('botChatRadarrFoundNMovies', movie.length)];

        _.forEach(movie, function(n, key) {

            var imageCover = null;
            _.forEach(n.images, function(image, index){
                if(image.coverType === 'poster'){
                    imageCover = image.url;
                }
            });

            var id = key + 1;
            var keyboardValue = n.title + (n.year ? ' - ' + n.year : '');

            movieList.push({
                'id': id,
                'title': n.title,
                'plot': n.overview,
                'year': n.year,
                'tmdbId': n.tmdbId,
                'titleSlug': n.titleSlug,
                'keyboardValue': keyboardValue,
                'coverUrl': imageCover
            });

            keyboardList.push([keyboardValue]);

            response.push('➸ ['+keyboardValue+'](https://www.themoviedb.org/movie/'+n.tmdbId+')');
        });

        response.push(i18n.__('selectFromMenu'));

        logger.info(i18n.__('logRadarrFoundMovies2', self.username, keyboardList.join(',')));

        // set cache
        self.cache.set('movieList' + self.user.id, movieList);
        self.cache.set('state' + self.user.id, state.radarr.CONFIRM);

        return self._sendMessage(response.join('\n'), keyboardList);
    })
        .catch(function(error) {
            return self._sendMessage(error);
        });
};

RadarrMessage.prototype.confirmMovieSelect = function(displayName) {
    var self = this;
   
    var movieList = self.cache.get('movieList' + self.user.id);

    if (!movieList) {
        return self._sendMessage(new Error(i18n.__('errorRadarrWentWrong')));
    }

    var movie = _.filter(movieList, function(item) { return item.keyboardValue === displayName; })[0];
    if (!movie) {
        return self._sendMessage(new Error(i18n.__('botChatRadarrMovieNotFound', displayName)));
    }

    // use workflow to run async tasks
    var workflow = new (require('events').EventEmitter)();

    // check for existing movie on radarr
    workflow.on('checkRadarrMovies', function () {
        self.radarr.get('movie').then(function(result) {
            logger.info(i18n.__('logRadarrLookingForExistingMovies', self.username));

            var existingMovies = _.filter(result, function(item) { return item.tmdbId === movie.tmdbId; })[0];
            if (existingMovies) {
                throw new Error(i18n.__('errorRadarrMovieAlreadyTracked'));
            }
            workflow.emit('confirmMovie');
        }).catch(function(error) {
            return self._sendMessage(error);
        });
    });

    // check for existing movie on radarr
    workflow.on('confirmMovie', function () {
        self.radarr.get('movie').then(function(result) {
            logger.info(i18n.__('logRadarrConfirmCorrectMovie', movie.keyboardValue, self.username));

            var keyboardList = [[i18n.__('globalYes')], [i18n.__('globalNo')]];

            var response = ['*' + movie.title + ' (' + movie.year + ')*\n'];

            response.push(movie.plot + '\n');
            response.push(i18n.__('botChatRadarrIsShowCorrect'));
            response.push(i18n.__('globalArrowYes'));
            response.push(i18n.__('globalArrowNo'));

            // Add cover to message (if available)
            if(movie.coverUrl !== null){
                response.push('\n[Poster!](' + movie.coverUrl + ')');
            }

            // set cache
            self.cache.set('state' + self.user.id, state.radarr.PROFILE);
            self.cache.set('movieId' + self.user.id, movie.id);

            return self._sendMessage(response.join('\n'), keyboardList);

        }).catch(function(error) {
            return self._sendMessage(error);
        });
    });

    /**
   * Initiate the workflow
   */
    workflow.emit('checkRadarrMovies');
};

RadarrMessage.prototype.sendProfileList = function(displayName) {
    var self = this;

    var movieId = self.cache.get('movieId' + self.user.id);

    if (!movieId) {
        return self._sendMessage(new Error(i18n.__('errorRadarrWentWrong')));
    }

    if(displayName == 'No'){
        return self._sendMessage(new Error(i18n.__('globalAborted')));
    }

    // use workflow to run async tasks
    var workflow = new (require('events').EventEmitter)();

    // get the radarr profiles
    workflow.on('getRadarrProfiles', function () {
        self.radarr.get('profile').then(function(result) {
            if (!result.length) {
                throw new Error(i18n.__('errorRadarrCouldntGetProfile'));
            }

            var profiles = result;

            logger.info(i18n.__('logRadarrProfileListRequested', self.username));

            var profileList = [], keyboardList = [], keyboardRow = [];
            var response = ['*Found ' + profiles.length + ' profiles*'];
            _.forEach(profiles, function(n, key) {

                profileList.push({ 'name': n.name, 'profileId': n.id });
                response.push('➸ ' + n.name);

                // Profile names are short, put two on each custom
                // keyboard row to reduce scrolling
                keyboardRow.push(n.name);
                if (keyboardRow.length === 2) {
                    keyboardList.push(keyboardRow);
                    keyboardRow = [];
                }
            });

            if (keyboardRow.length === 1) {
                keyboardList.push([keyboardRow[0]]);
            }

            response.push(i18n.__('selectFromMenu'));

            logger.info(i18n.__('logRadarrFoundProfile', self.username, keyboardList.join(',')));

            // set cache
            
            self.cache.set('state' + self.user.id, state.radarr.FOLDER);
            self.cache.set('movieProfileList' + self.user.id, profileList);

            return self._sendMessage(response.join('\n'), keyboardList);
        })
            .catch(function(error) {
                return self._sendMessage(error);
            });
    });

    /**
   * Initiate the workflow
   */
    workflow.emit('getRadarrProfiles');
};


RadarrMessage.prototype.sendFolderList = function(profileName) {
   
    var self = this;
    
    var profileList = self.cache.get('movieProfileList' + self.user.id);
    if (!profileList) {
        return self._sendMessage(new Error(i18n.__('errorRadarrWentWrong')));
    }

    var profile = _.filter(profileList, function(item) { return item.name === profileName; })[0];
    if (!profile) {
        return self._sendMessage(new Error(i18n.__('errorRadarrWentWrong')));
    }

   
    self.radarr.get('rootfolder').then(function(result) {
        if (!result.length) {
            throw new Error(i18n.__('errorRadarrCouldntFindFolders'));
        }
        var folders = result;

        logger.info(i18n.__('logRadarrFolderListRequested', self.username));

        var folderList = [], keyboardList = [];
        var response = ['*Found ' + folders.length + ' folders*'];
        _.forEach(folders, function(n, key) {
            folderList.push({ 'path': n.path, 'folderId': n.id });

            response.push('➸ ' + n.path);

            keyboardList.push([n.path]);
        });
        response.push(i18n.__('selectFromMenu'));

        logger.info(i18n.__('logRadarrFoundFolders', self.username, keyboardList.join(',')));

        // set cache
        self.cache.set('movieProfileId' + self.user.id, profile.profileId);
        self.cache.set('movieFolderList' + self.user.id, folderList);
        self.cache.set('state' + self.user.id, state.radarr.ADD_MOVIE);
        return self._sendMessage(response.join('\n'), keyboardList);
    })
        .catch(function(error) {
            return self._sendMessage(error);
        });
};

RadarrMessage.prototype.sendAddMovie = function(folderName) {
    var self = this;



    var folderList = self.cache.get('movieFolderList' + self.user.id);
    if (!folderList) {
        return self._sendMessage(new Error(i18n.__('errorRadarrWentWrong')));
    }

    var folder = _.filter(folderList, function(item) { return item.path === folderName; })[0];
    if (!folder) {
        return self._sendMessage(new Error(i18n.__('errorRadarrWentWrong')));
    }

    self.cache.set('movieFolderId' + self.user.id, folder.folderId);
    var movieId         = self.cache.get('movieId' + self.user.id);
    var movieList       = self.cache.get('movieList' + self.user.id);
    var profileId        = self.cache.get('movieProfileId' + self.user.id);
    var profileList      = self.cache.get('movieProfileList' + self.user.id);
    //var monitorId        = self.cache.get('movieMonitorId' + self.user.id);
    //var monitorList      = self.cache.get('movieMonitorList' + self.user.id);
    //var typeId           = self.cache.get('movieTypeId' + self.user.id);
    //var typeList         = self.cache.get('movieTypeList' + self.user.id);
    var folderId         = self.cache.get('movieFolderId' + self.user.id);
    //var folderList       = self.cache.get('movieFolderList' + self.user.id);
    //var seasonFolderId   = seasonFolderName;
    //var seasonFolderList = self.cache.get('movieSeasonFolderList' + self.user.id);
    console.log("ADDMOVIE1");


    if (!folderList) {
        self._sendMessage(new Error(i18n.__('errorRadarrWentWrong')));
    }

    var movie       = _.filter(movieList, function(item) { return item.id === movieId; })[0];
    var profile      = _.filter(profileList, function(item) { return item.profileId === profileId; })[0];
    //var monitor      = _.filter(monitorList, function(item) { return item.type === monitorId; })[0];
    //var type         = _.filter(typeList, function(item) { return item.type === typeId; })[0];
    //var folder       = _.filter(folderList, function(item) { return item.folderId === folderId; })[0];
    //var seasonFolder = _.filter(seasonFolderList, function(item) { return item.type === seasonFolderId; })[0];
    console.log("FLAG");
    console.log((movie != null? 'true' : 'false' )+ ' | ' + (folder != null? 'true' : 'false') + ' | ' + (profile != null? 'true' : 'false'));
    console.log("FLAG2");
    console.log(movie.tmdbId != null + ' ' + movie.title != null + ' ' + movie.titleSlug != null + ' ' + folder.path != null + ' ' + profile.profileId != null);
    console.log("FLAG3");
    
   
    var postOpts              = {};
    postOpts.tmdbId           = movie.tmdbId;
    postOpts.title            = movie.title;
    postOpts.titleSlug        = movie.titleSlug;
    postOpts.rootFolderPath   = folder.path;
    postOpts.monitored        = true;
    postOpts.qualityProfileId = profile.profileId;
    postOpts.images           = [];
    
    
    logger.info(i18n.__('logRadarrMovieAddedWithOptions', self.username, movie.title, JSON.stringify(postOpts)));

    self.radarr.post('movie', postOpts).then(function(result) {
        if (!result) {
            throw new Error(i18n.__('logRadarrMovieCantAdd'));
        }

        logger.info(i18n.__('logRadarrMovieAdded', self.username, movie.title));

        if (self._isBotAdmin() && self.adminId !== self.user.id) {
            if ( self.chat ){
                var mentionStr = '[' + self.user.first_name + ' ' + self.user.last_name + '](tg://user?id=' + (self.user.id) + ') \n';
                self.bot.sendMessage(self.chat.id, (mentionStr) + i18n.__('botChatRadarrMovieAddedBy', movie.title, self.username), {
                    'selective': 2,
                    'parse_mode': 'Markdown',
                    'reply_markup': {
                        'hide_keyboard': true
                    }
                });
            }
            self.bot.sendMessage(self.user.id, i18n.__('botChatRadarrMovieAddedBy', movie.title, self.username), {
                'selective': 2,
                'parse_mode': 'Markdown',
                'reply_markup': {
                    'hide_keyboard': true
                }
            });
        }
        
        if ( self.chat ){
            var mentionStr = '[' + self.user.first_name + ' ' + self.user.last_name + '](tg://user?id=' + (self.user.id) + ') \n';
            return self.bot.sendMessage(self.chat.id, (mentionStr) + i18n.__('botChatRadarrMovieAddedBy', movie.title, self.username), {
                'selective': 2,
                'parse_mode': 'Markdown',
                'reply_markup': {
                    'hide_keyboard': true
                }
            });
        }
        return self.bot.sendMessage(self.user.id, i18n.__('botChatRadarrMovieAdded', movie.title), {
            'selective': 2,
            'parse_mode': 'Markdown',
            'reply_markup': {
                'hide_keyboard': true
            }
        });
    })
        .catch(function(error) {
            return self._sendMessage(error);
        })
        .finally(function() {
            self._clearCache();
        });

};

/*
 * private methods
 */
RadarrMessage.prototype._sendMessage = function(message, keyboard) {
    var self = this;
    keyboard = keyboard || null;
    var options;
    if (message instanceof Error ) {
        logger.warn(i18n.__('logMessageClear', self.username, message.message));

        message = message.message;
        options = {
            'parse_mode': 'Markdown',
            'reply_markup': {
                'hide_keyboard': true
            }
        };
    } else if(keyboard == null) {

        options = {
            'parse_mode': 'Markdown',
            'reply_markup': {
                'hide_keyboard': true
            }
        };

    } else {
        options = {
            // 'disable_web_page_preview': true,
            'parse_mode': 'Markdown',
            'selective': 2,
            'reply_markup': JSON.stringify( { keyboard: keyboard, one_time_keyboard: true })
        };
    }
    //if we're in a chat, then send to the chat. 
    if ( self.chat && self.chat.id ){
        var mentionStr = '[' + self.user.first_name + ' ' + self.user.last_name + '](tg://user?id=' + (self.user.id) + ') \n';
        return self.bot.sendMessage(self.chat.id, (mentionStr) + message, options);
    }

    return self.bot.sendMessage(self.user.id, message, options);
};

RadarrMessage.prototype._isBotAdmin = function() {
    if (this.adminId === this.user.id) {
        return true;
    }
    return false;
};

RadarrMessage.prototype._clearCache = function() {
    var self = this;

    logger.info(i18n.__('logClearCache', self.username));

    var cacheItems = [
        'movieId', 'movieList', 'movieProfileId',
        'movieProfileList', 'movieFolderId', 'movieFolderList', 'movieFolderId',
        'movieFolderList', 'state'
    ];

    return _(cacheItems).forEach(function(item) {
        self.cache.del(item + self.user.id);
    });
};

module.exports = RadarrMessage;
