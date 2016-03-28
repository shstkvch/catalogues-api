console.log('vubis connector loading');

///////////////////////////////////////////
// REQUIRES
// Request (for HTTP calls) and cheerio for 
// querying HTML
///////////////////////////////////////////
var request = require('request'),
    cheerio = require('cheerio');

///////////////////////////////////////////
// VARIABLES
///////////////////////////////////////////
var searchUrl = 'List.csp?Index1=Isbn&Database=1&Location=NoPreference&Language=NoPreference&PublicationType=NoPreference&OpacLanguage=eng&NumberToRetrieve=50&SearchMethod=Find_1&SearchTerm1=[ISBN]&Profile=Default&PreviousList=Start&PageType=Start&WebPageNr=1&WebAction=NewSearch&StartValue=1&RowRepeat=0&MyChannelCount=&SearchT1=';

///////////////////////////////////////////
// Function: getLibraries
///////////////////////////////////////////
exports.getLibraries = function (service, callback) {
    var responseLibraries = { service: service.Name, libs: [], start: new Date() };
    var handleError = function (error) {
        if (error) {
            responseLibraries.error = error;
            responseLibraries.end = new Date();
            callback(responseLibraries);
            return true;
        }
    };
    var reqStatusCheck = function (message) {
        if (message.statusCode != 200) {
            responseLibraries.error = "Web request error.";
            responseLibraries.end = new Date();
            callback(responseLibraries);
            return true;
        }
    };

    // Request 1. This gets the frameset
    request.get({ url: service.Url + 'vubis.csp', timeout: 20000 }, function (error, message, response) {
        if (handleError(error)) return;
        $ = cheerio.load(response);
        var link = $('FRAME[Title="Vubis.Body"]').attr('src');
        // Request 2. Get the internal body page.
        request.get({ url: service.Url + link, timeout: 20000 }, function (error, message, response) {
            if (handleError(error)) return;
            $ = cheerio.load(response);
            $('select[name=Location] option').each(function () {
                if ($(this).text().trim() != 'No preference') responseLibraries.libs.push($(this).text().trim());
            });
            responseLibraries.end = new Date();
            callback(responseLibraries);
        });
    });
};

///////////////////////////////////////////
// Function: searchByISBN
// This is a horrible chain of requests.  Particularly as the data returned is always within 
// framesets (in 2016!) - so you need to get the url from the relevant frame.
// Probably can do all this from a single call - will investigate
///////////////////////////////////////////
exports.searchByISBN = function (isbn, lib, callback) {
    var responseHoldings = { service: lib.Name, availability: [], start: new Date() };
    var handleError = function (error) {
        if (error) {
            responseHoldings.error = error;
            responseHoldings.end = new Date();
            callback(responseHoldings);
            return true;
        }
    };
    // Declaring this here to use later on
    var itemRequest = function (link) {
        request.get({ url: link, timeout: 20000 }, function (error, msg, response) {
            if (handleError(error)) return;
            var libs = {};
            $ = cheerio.load(response);
            var availIndex = $('table[summary="FullBB.HoldingDetails"] tr').eq(1).find(':contains(Availability)').index();
            var shelfMarkIndex = $('table[summary="FullBB.HoldingDetails"] tr').eq(1).find(':contains(Shelfmark)').index();
            $('table[summary="FullBB.HoldingDetails"] tr').slice(2).each(function () {
                var status = $(this).find('td').eq(availIndex).text().trim();
                var name = $(this).find('td').eq(shelfMarkIndex).text().trim();
                if (name.indexOf(':') != -1) name = name.split(':')[0];
                if (name.indexOf('/') != -1) name = name.split('/')[0];
                if (!libs[name]) libs[name] = { available: 0, unavailable: 0 };
                status == 'Available' ? libs[name].available++ : libs[name].unavailable++;
            });
            for (var l in libs) responseHoldings.availability.push({ library: l, available: libs[l].available, unavailable: libs[l].unavailable });
            responseHoldings.end = new Date();
            callback(responseHoldings);
        });
    };

    // Request 1: Kick off a session
    request.get({ url: lib.Url + 'vubis.csp', timeout: 20000 }, function (error, message, response) {
        if (handleError(error)) return;
        $ = cheerio.load(response);
        var link = $('FRAME[Title="Vubis.Body"]').attr('src');
        // Request 2: Should now have the StartBody link - do it!
        request.get({ url: lib.Url + link, timeout: 20000 }, function (error, message, response) {
            if (handleError(error)) return;
            $ = cheerio.load(response);
            // Get the encoded value to perform the search.
            var enc = $('input[name=EncodedRequest]').attr('value');
            var url = lib.Url + searchUrl.replace('[ISBN]', isbn) + isbn + '&EncodedRequest=' + enc;

            // Request 3: Get the search frameset (*voms*)
            request.get({ url: url, timeout: 20000 }, function (error, msg, response) {
                if (handleError(error)) return;
                $ = cheerio.load(response);
                // In some (but not all) cases this will redirect to the relevant item page
                var link = $('FRAME[title="List.Body"]').attr('src');
                if (link && link.indexOf('ListBody') != -1) {
                    request.get({ url: lib.Url + link, timeout: 20000 }, function (error, msg, response) {
                        if (handleError(error)) return;
                        $ = cheerio.load(response);
                        var link = $('td.listitemOdd').last().find('a').attr('href');
                        if (link) {
                            request.get(lib.Url + link, function (error, message, response) {
                                if (handleError(error)) return;
                                $ = cheerio.load(response);
                                var link = $('frame').eq(1).attr('src');
                                if (link) {
                                    link = link.substring(link.indexOf('FullBBBody'));
                                    itemRequest(lib.Url + link);
                                } else {
                                    responseHoldings.end = new Date();
                                    callback(responseHoldings);
                                }
                            });
                        } else {
                            responseHoldings.end = new Date();
                            callback(responseHoldings);
                        }
                    });
                } else if (link && link.indexOf('FullBBBody') != -1) {
                    itemRequest(lib.Url + link);
                } else {
                    responseHoldings.end = new Date();
                    callback(responseHoldings);
                }
            });
        });
    });
};