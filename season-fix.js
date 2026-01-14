(function () {
	"use strict";

	var SEASON_FIX = {
		id: "season_fix",
		version: "1.5",
		tvmaze_cache: {},
		current_tv_id: null,

		init: function () {
			var _this = this;
			var attempts = 0;
			var maxAttempts = 100;

			var waitForLampa = function () {
				attempts++;

				if (typeof Lampa === "undefined") {
					if (attempts < maxAttempts) {
						setTimeout(waitForLampa, 100);
					}
					return;
				}

				if (!Lampa.Utils || !Lampa.Utils.splitEpisodesIntoSeasons) {
					if (attempts < maxAttempts) {
						setTimeout(waitForLampa, 100);
					}
					return;
				}

				_this.hook();
			};

			if (typeof Lampa !== "undefined" && Lampa.Listener) {
				Lampa.Listener.follow("app", function (e) {
					if (e.type === "ready") {
						_this.hook();
					}
				});
			}

			waitForLampa();
		},

		hook: function () {
			var _this = this;

			if (this.hooked) {
				return;
			}

			if (
				typeof Lampa === "undefined" ||
				!Lampa.Utils ||
				!Lampa.Utils.splitEpisodesIntoSeasons
			) {
				return;
			}

			this.hooked = true;

			window.SEASON_FIX = _this;

			this.overrideSplitFunction();
			this.hookTMDB();
			this.hookAjax();
		},

		overrideSplitFunction: function () {
			var _this = this;
			var originalSplit = Lampa.Utils.splitEpisodesIntoSeasons;

			Lampa.Utils.splitEpisodesIntoSeasons = function (episodes, gap) {
				if (!Array.isArray(episodes) || episodes.length === 0) {
					return {};
				}

				var tvId =
					(episodes[0] && (episodes[0].show_id || episodes[0].series_id)) ||
					_this.current_tv_id;
				var seasonMap = tvId ? _this.tvmaze_cache[tvId] : null;

				if (
					seasonMap &&
					typeof seasonMap === "object" &&
					Object.keys(seasonMap).length > 0
				) {
					return _this.splitByTvmaze(episodes, seasonMap);
				}

				return originalSplit.call(this, episodes, gap);
			};
		},

		splitByTvmaze: function (episodes, seasonMap) {
			var sorted = episodes.slice().sort(function (a, b) {
				return (a.episode_number || 0) - (b.episode_number || 0);
			});

			var seasons = {};
			var currentSeason = 1;
			var episodeCounter = 0;
			var seasonLimit = seasonMap[currentSeason] || 9999;

			for (var i = 0; i < sorted.length; i++) {
				var ep = sorted[i];
				episodeCounter++;

				if (episodeCounter > seasonLimit) {
					currentSeason++;
					episodeCounter = 1;
					seasonLimit = seasonMap[currentSeason] || 9999;
				}

				if (!seasons[currentSeason]) {
					seasons[currentSeason] = [];
				}

				var newEp;
				try {
					newEp = JSON.parse(JSON.stringify(ep));
				} catch (e) {
					newEp = {};
					for (var k in ep) {
						if (ep.hasOwnProperty(k)) newEp[k] = ep[k];
					}
				}

				newEp.season_number = currentSeason;
				newEp.episode_number = episodeCounter;
				newEp.id = 900000 + currentSeason * 1000 + episodeCounter;
				seasons[currentSeason].push(newEp);
			}

			return seasons;
		},

		hookTMDB: function () {
			var _this = this;

			if (typeof Lampa === "undefined" || !Lampa.TMDB) {
				return;
			}

			if (Lampa.TMDB.get) {
				var originalGet = Lampa.TMDB.get;

				Lampa.TMDB.get = function (method) {
					var tvMatch = method ? method.match(/tv\/(\d+)/) : null;
					if (tvMatch) {
						var tvId = tvMatch[1];
						_this.current_tv_id = tvId;

						if (!_this.tvmaze_cache[tvId]) {
							_this.fetchTvmaze(tvId);
						}
					}
					return originalGet.apply(this, arguments);
				};
			}
		},

		hookAjax: function () {
			var _this = this;

			if (typeof $ === "undefined" || !$.ajax) {
				return;
			}

			var originalAjax = $.ajax;

			$.ajax = function (url, options) {
				var settings = typeof url === "object" ? url : options || {};
				var reqUrl = typeof url === "string" ? url : settings.url || "";

				var tvMatch = reqUrl.match(/\/tv\/(\d+)/);
				if (tvMatch) {
					var tvId = tvMatch[1];
					_this.current_tv_id = tvId;

					var apiKeyMatch = reqUrl.match(/api_key=([^&]+)/);
					var apiKey = apiKeyMatch ? apiKeyMatch[1] : null;

					if (!_this.tvmaze_cache[tvId] && apiKey) {
						_this.fetchTvmaze(tvId, apiKey);
					}
				}

				return originalAjax.apply(this, arguments);
			};
		},

		fetchTvmaze: function (tvId, apiKey) {
			var _this = this;

			if (this.tvmaze_cache[tvId]) {
				return;
			}

			this.tvmaze_cache[tvId] = "loading";

			if (
				!apiKey &&
				typeof Lampa !== "undefined" &&
				Lampa.TMDB &&
				Lampa.TMDB.key
			) {
				apiKey = Lampa.TMDB.key();
			}

			if (!apiKey) {
				delete this.tvmaze_cache[tvId];
				return;
			}

			var externalUrl;
			if (typeof Lampa !== "undefined" && Lampa.TMDB && Lampa.TMDB.api) {
				externalUrl = Lampa.TMDB.api(
					"tv/" + tvId + "/external_ids?api_key=" + apiKey
				);
			} else {
				externalUrl =
					"https://api.themoviedb.org/3/tv/" +
					tvId +
					"/external_ids?api_key=" +
					apiKey;
			}

			this.makeRequest(externalUrl, function (ids, status, error) {
				if (!ids) {
					delete _this.tvmaze_cache[tvId];
					return;
				}

				var lookupId = null;
				var lookupType = null;

				if (ids.imdb_id) {
					lookupId = ids.imdb_id;
					lookupType = "imdb";
				} else if (ids.tvdb_id) {
					lookupId = ids.tvdb_id;
					lookupType = "thetvdb";
				}

				if (!lookupId) {
					delete _this.tvmaze_cache[tvId];
					return;
				}

				var lookupUrl =
					"https://api.tvmaze.com/lookup/shows?" + lookupType + "=" + lookupId;

				_this.makeRequest(lookupUrl, function (showData, status2, error2) {
					if (!showData || !showData.id) {
						delete _this.tvmaze_cache[tvId];
						return;
					}

					var episodesUrl =
						"https://api.tvmaze.com/shows/" + showData.id + "/episodes";

					_this.makeRequest(episodesUrl, function (episodes, status3, error3) {
						if (!episodes || !episodes.length) {
							delete _this.tvmaze_cache[tvId];
							return;
						}

						var map = {};
						for (var i = 0; i < episodes.length; i++) {
							var ep = episodes[i];
							var s = ep.season;
							if (!map[s]) map[s] = 0;
							map[s]++;
						}

						if (Object.keys(map).length > 0) {
							_this.tvmaze_cache[tvId] = map;
							window.dispatchEvent(
								new CustomEvent("tvmaze_loaded", { detail: { id: tvId } })
							);
						} else {
							delete _this.tvmaze_cache[tvId];
						}
					});
				});
			});
		},

		makeRequest: function (url, callback) {
			var _this = this;

			var useLampaReguest = function () {
				if (typeof Lampa === "undefined" || !Lampa.Reguest) {
					useFetch();
					return;
				}

				try {
					var network = new Lampa.Reguest();
					network.timeout(15000);

					var isTmdbUrl =
						url.indexOf("themoviedb.org") !== -1 ||
						url.indexOf("apitmdb.") !== -1;
					var method = isTmdbUrl ? "silent" : "native";

					var successCb = function (data) {
						callback(data, 200, null);
					};

					var errorCb = function (e, x) {
						useFetch();
					};

					if (method === "native") {
						network.native(url, successCb, errorCb);
					} else {
						network.silent(url, successCb, errorCb);
					}
				} catch (e) {
					useFetch();
				}
			};

			var useXHR = function () {
				try {
					var xhr = new XMLHttpRequest();
					xhr.open("GET", url, true);
					xhr.timeout = 15000;

					xhr.onload = function () {
						if (xhr.status >= 200 && xhr.status < 300) {
							try {
								var data = JSON.parse(xhr.responseText);
								callback(data, xhr.status, null);
							} catch (e) {
								callback(null, xhr.status, "parse error");
							}
						} else {
							callback(null, xhr.status, "status " + xhr.status);
						}
					};

					xhr.onerror = function () {
						callback(null, 0, "network error");
					};

					xhr.ontimeout = function () {
						callback(null, 0, "timeout");
					};

					xhr.send();
				} catch (e) {
					callback(null, 0, e.message);
				}
			};

			var useJQuery = function () {
				if (typeof $ === "undefined" || !$.ajax) {
					useXHR();
					return;
				}

				$.ajax({
					url: url,
					type: "GET",
					dataType: "json",
					timeout: 15000,
					success: function (data, textStatus, jqXHR) {
						callback(data, jqXHR ? jqXHR.status : 200, null);
					},
					error: function (jqXHR, textStatus, errorThrown) {
						useXHR();
					}
				});
			};

			var useFetch = function () {
				if (typeof fetch === "undefined") {
					useJQuery();
					return;
				}

				var controller;
				var timeoutId;

				try {
					if (typeof AbortController !== "undefined") {
						controller = new AbortController();
						timeoutId = setTimeout(function () {
							controller.abort();
						}, 15000);
					}
				} catch (e) {}

				fetch(url, controller ? { signal: controller.signal } : {})
					.then(function (response) {
						if (timeoutId) clearTimeout(timeoutId);
						if (!response.ok) {
							throw new Error("HTTP " + response.status);
						}
						return response.json();
					})
					.then(function (data) {
						callback(data, 200, null);
					})
					.catch(function (error) {
						if (timeoutId) clearTimeout(timeoutId);
						useJQuery();
					});
			};

			useLampaReguest();
		}
	};

	function start() {
		if (window.ANIME_FIX_LOADED) {
			return;
		}
		window.ANIME_FIX_LOADED = true;
		SEASON_FIX.init();
	}

	if (
		document.readyState === "complete" ||
		document.readyState === "interactive"
	) {
		setTimeout(start, 0);
	} else {
		document.addEventListener("DOMContentLoaded", start);
	}

	if (typeof Lampa !== "undefined") {
		if (window.appready) {
			start();
		} else if (Lampa.Listener) {
			Lampa.Listener.follow("app", function (e) {
				if (e.type === "ready") {
					start();
				}
			});
		}
	} else {
		var checkInterval = setInterval(function () {
			if (typeof Lampa !== "undefined") {
				clearInterval(checkInterval);
				if (window.appready) {
					start();
				} else if (Lampa.Listener) {
					Lampa.Listener.follow("app", function (e) {
						if (e.type === "ready") {
							start();
						}
					});
				}
			}
		}, 100);

		setTimeout(function () {
			clearInterval(checkInterval);
			start();
		}, 5000);
	}
})();
