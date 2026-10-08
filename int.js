(function () {
	"use strict";
	if (typeof Lampa === "undefined") return;

	if (!Lampa.Maker || !Lampa.Maker.map || !Lampa.Utils) return;
	if (window.plugin_interface_ready_v3) return;

	var mainMaker = Lampa.Maker.map("Main");
	if (!mainMaker || !mainMaker.Items || !mainMaker.Create) return;

	Lampa.Platform.tv();
	window.plugin_interface_ready_v3 = true;

	var globalInfoCache = Object.create(null);
	var pendingInfoRequests = Object.create(null);
	var preloadTimer = null;
	var ratingSelector = ".card__vote, .full-start__rate, .full-start-new__rate, .info__rate, .card__imdb-rate, .card__kinopoisk-rate";
	var ratingGroupSelector = ".rate--kp, .rate--imdb, .rate--cub";

	blockShotsPlugin();

	addStyles();
	initializeSettings();
	setupHistoryCaptions();

	siStyleSetupVoteColorsObserver();
	siStyleSetupVoteColorsForDetailPage();
	setupPreloadObserver();

	wrapMethod(mainMaker.Items, "onInit", function (originalMethod, args) {
		this.__newInterfaceEnabled = shouldEnableInterface(this.object);

		if (this.__newInterfaceEnabled) {
			if (this.object) this.object.wide = false;
			this.wide = false;
		}

		if (originalMethod) originalMethod.apply(this, args);
	});

	wrapMethod(mainMaker.Create, "onCreate", function (originalMethod, args) {
		if (originalMethod) originalMethod.apply(this, args);
		if (!this.__newInterfaceEnabled) return;

		var state = getOrCreateState(this);
		state.attach();
	});

	wrapMethod(
		mainMaker.Create,
		"onCreateAndAppend",
		function (originalMethod, args) {
			var data = args[0];
			if (this.__newInterfaceEnabled && data) {
				data.wide = false;

				if (!data.params) data.params = {};
				if (!data.params.items) data.params.items = {};
				data.params.items.view = 12;
				data.params.items_per_row = 12;
				data.items_per_row = 12;

				extendResultsWithStyle(data);
			}
			return originalMethod ? originalMethod.apply(this, args) : undefined;
		}
	);

	wrapMethod(mainMaker.Items, "onAppend", function (originalMethod, args) {
		if (originalMethod) originalMethod.apply(this, args);
		if (!this.__newInterfaceEnabled) return;

		var element = args[0];
		var data = args[1];

		if (element && data) {
			handleLineAppend(this, element);
		}
	});

	wrapMethod(mainMaker.Items, "onDestroy", function (originalMethod, args) {
		if (this.__newInterfaceState) {
			this.__newInterfaceState.destroy();
			delete this.__newInterfaceState;
		}
		delete this.__newInterfaceEnabled;
		if (originalMethod) originalMethod.apply(this, args);
	});

	function shouldEnableInterface(object) {
		if (!object) return false;
		if (window.innerWidth < 767) return false;
		if (Lampa.Platform.screen("mobile")) return false;
		if (object.title === "Избранное") return false;
		return true;
	}

	function getOrCreateState(createInstance) {
		if (createInstance.__newInterfaceState) {
			return createInstance.__newInterfaceState;
		}
		var state = createState(createInstance);
		createInstance.__newInterfaceState = state;
		return state;
	}

	function createState(mainInstance) {
		var infoPanel = new InfoPanel();
		infoPanel.create();

		var backgroundWrapper = document.createElement("div");
		backgroundWrapper.className = "full-start__background-wrapper";

		var bg1 = document.createElement("img");
		bg1.className = "full-start__background";
		var bg2 = document.createElement("img");
		bg2.className = "full-start__background";

		backgroundWrapper.appendChild(bg1);
		backgroundWrapper.appendChild(bg2);

		var state = {
			infoElement: null,
			backgroundTimer: null,
			backgroundTransitionTimer: null,
			destroyed: false,
			backgroundLast: "",
			attached: false,

			attach: function () {
				if (this.attached) return;

				var container = mainInstance.render(true);
				if (!container) return;

				container.classList.add("new-interface");

				if (!backgroundWrapper.parentElement) {
					container.insertBefore(
						backgroundWrapper,
						container.firstChild || null
					);
				}

				var infoElement = infoPanel.render(true);
				this.infoElement = infoElement;

				if (infoElement && infoElement.parentNode !== container) {
					if (backgroundWrapper.parentElement === container) {
						container.insertBefore(infoElement, backgroundWrapper.nextSibling);
					} else {
						container.insertBefore(infoElement, container.firstChild || null);
					}
				}

				mainInstance.scroll.minus(infoElement);
				this.attached = true;
			},

			update: function (data) {
				if (!data || this.destroyed) return;
				infoPanel.update(data);
				this.updateBackground(data);
			},

			updateBackground: function (data) {
				var BACKGROUND_DEBOUNCE_DELAY = 300;
				var self = this;

				clearTimeout(this.backgroundTimer);

				if (this._pendingImg) {
					this._pendingImg.onload = null;
					this._pendingImg.onerror = null;
					this._pendingImg = null;
				}

				var show_bg = Lampa.Storage.get("show_background", true);
				var bg_resolution = Lampa.Storage.get(
					"background_resolution",
					"original"
				);
				var backdropUrl =
					data && data.backdrop_path && show_bg
						? Lampa.Api.img(data.backdrop_path, bg_resolution)
						: "";

				if (backdropUrl === this.backgroundLast && (!backdropUrl || bg1.classList.contains("active") || bg2.classList.contains("active"))) return;

				this.backgroundTimer = setTimeout(function () {
					if (!backdropUrl) {
						bg1.classList.remove("active");
						bg2.classList.remove("active");
						self.backgroundLast = "";
						return;
					}

					var nextLayer = bg1.classList.contains("active") ? bg2 : bg1;
					var prevLayer = bg1.classList.contains("active") ? bg1 : bg2;

					var img = new Image();
					self._pendingImg = img;

					img.onload = function () {
						if (self._pendingImg !== img) return;
						if (!Lampa.Storage.get("show_background", true)) {
							self._pendingImg = null;
							return;
						}
						self.backgroundLast = backdropUrl;
						self._pendingImg = null;
						nextLayer.src = backdropUrl;
						nextLayer.classList.add("active");

						clearTimeout(self.backgroundTransitionTimer);
						self.backgroundTransitionTimer = setTimeout(function () {
							if (backdropUrl !== self.backgroundLast) return;
							prevLayer.classList.remove("active");
						}, 100);
					};

					img.onerror = function () {
						if (self._pendingImg === img) self._pendingImg = null;
					};
					img.src = backdropUrl;
				}, BACKGROUND_DEBOUNCE_DELAY);
			},

			reset: function () {
				infoPanel.empty();
			},

			destroy: function () {
				this.destroyed = true;
				clearTimeout(this.backgroundTimer);
				clearTimeout(this.backgroundTransitionTimer);
				if (this._pendingImg) {
					this._pendingImg.onload = null;
					this._pendingImg.onerror = null;
					this._pendingImg = null;
				}
				infoPanel.destroy();

				var container = mainInstance.render(true);
				if (container) {
					container.classList.remove("new-interface");
				}

				if (this.infoElement && this.infoElement.parentNode) {
					this.infoElement.parentNode.removeChild(this.infoElement);
				}

				if (backgroundWrapper && backgroundWrapper.parentNode) {
					backgroundWrapper.parentNode.removeChild(backgroundWrapper);
				}

				this.attached = false;
			}
		};

		return state;
	}

	function initChildModeApiHook() {
		if (!Lampa.TMDB || !Lampa.TMDB.api) return;

		var originalApi = Lampa.TMDB.api;

		Lampa.TMDB.api = function (url) {
			if (Lampa.Storage.get("child_mode", false)) {
				if (
					url.indexOf("discover/") !== -1 ||
					url.indexOf("trending/") !== -1 ||
					url.indexOf("movie/popular") !== -1 ||
					url.indexOf("movie/top_rated") !== -1 ||
					url.indexOf("movie/now_playing") !== -1 ||
					url.indexOf("movie/upcoming") !== -1 ||
					url.indexOf("tv/popular") !== -1 ||
					url.indexOf("tv/top_rated") !== -1 ||
					url.indexOf("tv/on_the_air") !== -1 ||
					url.indexOf("tv/airing_today") !== -1
				) {
					if (url.indexOf("certification") === -1) {
						var separator = url.indexOf("?") !== -1 ? "&" : "?";
						url =
							url +
							separator +
							"certification_country=RU&certification.lte=16&include_adult=false";
					}
				}
				if (
					url.indexOf("include_adult") === -1 &&
					url.indexOf("search/") !== -1
				) {
					var separator = url.indexOf("?") !== -1 ? "&" : "?";
					url = url + separator + "include_adult=false";
				}
			}
			arguments[0] = url;
			return originalApi.apply(this, arguments);
		};
	}

	initChildModeApiHook();

	function extendResultsWithStyle(data) {
		if (!data) return;

		if (Array.isArray(data.results)) {
			data.results.forEach(function (card) {
				if (card.wide !== false) {
					card.wide = false;
				}
			});

			Lampa.Utils.extendItemsParams(data.results, {
				style: {
					name: Lampa.Storage.get("wide_post") !== false ? "wide" : "small"
				}
			});
		}
	}

	function handleCard(state, card) {
		if (!card || card.__newInterfaceCard) return;
		if (typeof card.use !== "function" || !card.data) return;

		card.__newInterfaceCard = true;
		card.params = card.params || {};
		card.params.style = card.params.style || {};

		var targetStyle =
			Lampa.Storage.get("wide_post") !== false ? "wide" : "small";
		card.params.style.name = targetStyle;

		if (typeof card.render === "function") {
			var element = card.render(true);
			if (element) {
				var node = element.jquery ? element[0] : element;
				if (node && node.classList) {
					if (targetStyle === "wide") {
						node.classList.add("card--wide");
						node.classList.remove("card--small");
					} else {
						node.classList.add("card--small");
						node.classList.remove("card--wide");
					}
				}
			}
		}

		var update = function () {
			state.update(card.data);
		};
		card.use({
			onFocus: update,
			onHover: update,
			onTouch: update,
			onDestroy: function () {
				delete card.__newInterfaceCard;
			}
		});
	}

	function getCardData(card, results) {
		if (card && card.data) return card.data;
		if (results && Array.isArray(results.results)) {
			return results.results[0];
		}

		return null;
	}

	function findCardData(element) {
		if (!element) return null;

		var node = element.jquery ? element[0] : element;

		while (node && !node.card_data) {
			node = node.parentNode;
		}

		return node && node.card_data ? node.card_data : null;
	}

	function getFocusedCard(items) {
		var container =
			items && typeof items.render === "function" ? items.render(true) : null;
		if (!container || !container.querySelector) return null;

		var focusedElement =
			container.querySelector(".selector.focus") ||
			container.querySelector(".focus");
		return findCardData(focusedElement);
	}

	function handleLineAppend(items, line) {
		if (line.__newInterfaceLine) return;
		line.__newInterfaceLine = true;

		var state = getOrCreateState(items);

		line.items_per_row = 12;
		line.view = 12;
		if (line.params) {
			line.params.items_per_row = 12;
			if (line.params.items) line.params.items.view = 12;
		}

		var processCard = function (card) {
			handleCard(state, card);
		};

		var toggleTimer = null;
		line.use({
			onInstance: processCard,
			onActive: function (card, results) {
				var cardData = getCardData(card, results);
				if (cardData) state.update(cardData);
			},
			onToggle: function () {
				clearTimeout(toggleTimer);
				toggleTimer = setTimeout(function () {
					var focusedCard = getFocusedCard(line);
					if (focusedCard) state.update(focusedCard);
				}, 32);
			},
			onMore: function () {
				state.reset();
			},
			onDestroy: function () {
				state.reset();
				clearTimeout(toggleTimer);
				delete line.__newInterfaceLine;
			}
		});

		if (Array.isArray(line.items) && line.items.length) {
			line.items.forEach(processCard);
		}

		if (line.last) {
			var lastCardData = findCardData(line.last);
			if (lastCardData) state.update(lastCardData);
		}
	}

	function wrapMethod(object, methodName, wrapper) {
		if (!object) return;

		var originalMethod =
			typeof object[methodName] === "function" ? object[methodName] : null;

		object[methodName] = function () {
			return wrapper.call(this, originalMethod, arguments);
		};
	}

	function setupHistoryCaptions() {
		function update(object) {
			if (!object || !object.activity) return;
			object.activity.render().toggleClass(
				"new-interface-history",
				object.component === "favorite" && object.type === "history"
			);
		}

		Lampa.Listener.follow("activity", function (event) {
			if (event.type === "init" || event.type === "start") update(event.object);
		});
		Lampa.Activity.all().forEach(update);
	}

	function addStyles() {
		if (addStyles.added) return;
		addStyles.added = true;

		var styles = getStyles();

		Lampa.Template.add("new_interface_style_v3", styles);
		$("body").append(Lampa.Template.get("new_interface_style_v3", {}, true));
	}

	function getStyles() {
		var wide = Lampa.Storage.get("wide_post") !== false;
		return `<style>
			.items-line {
				padding-bottom: ${wide ? 4 : 3.2}em !important;
			}
			.new-interface-info__head, .new-interface-info__details{ opacity: 0; transition: opacity 0.5s ease; min-height: 2.2em !important;}
			.new-interface-info__head.visible, .new-interface-info__details.visible{ opacity: 1; }
			.new-interface .card.card--wide {
				width: 18.3em;
			}
			${wide ? ` .new-interface .card.card--small { width: 18.3em; } ` : `
			.items-line__title .full-person__photo {
				width: 1.8em !important;
				height: 1.8em !important;
				margin-right: 0.5em !important;
			}
			.items-line__title .full-person--svg .full-person__photo {
				padding: 0.5em !important;
				margin-right: 0.5em !important;
			}
			.new-interface-info__head { margin-bottom: 0.3em; }
			`}
			.new-interface-info {
				position: relative;
				padding: 1.5em;
				height: ${wide ? 27.5 : 19.8}em;
			}
			.new-interface-info__body {
				position: absolute;
				z-index: 9999999;
				width: 80%;
				padding-top: ${wide ? 1.1 : 0.2}em;
			}
			.new-interface-info__head {
				color: rgba(255, 255, 255, 0.6);
				font-size: ${wide ? 1.3 : 1.2}em;
				min-height: 1em;
			}
			.new-interface-info__head span {
				color: #fff;
			}
			.new-interface-info__title {
				font-size: ${wide ? 4 : 3}em;
				font-weight: 600;
				margin-bottom: ${wide ? 0.3 : 0.2}em;
				overflow: hidden;
				-o-text-overflow: '.';
				text-overflow: '.';
				display: -webkit-box;
				-webkit-line-clamp: 1;
				line-clamp: 1;
				-webkit-box-orient: vertical;
				margin-left: -0.03em;
				line-height: 1.3;
			}
			.new-interface-info__details {
				margin-top: 1.2em;
				margin-bottom: 1.6em;
				display: flex;
				align-items: center;
				flex-wrap: wrap;
				min-height: 1.9em;
				font-size: ${wide ? 1.3 : 1.2}em;
			}
			.new-interface-info__split {
				margin: 0 1em;
				font-size: 0.7em;
			}
			.new-interface-info__description {
				font-size: ${wide ? 1.4 : 1.3}em;
				font-weight: 310;
				line-height: 1.3;
				overflow: hidden;
				-o-text-overflow: '.';
				text-overflow: '.';
				display: -webkit-box;
				-webkit-line-clamp: ${wide ? 3 : 2};
				line-clamp: ${wide ? 3 : 2};
				-webkit-box-orient: vertical;
				width: ${wide ? 65 : 70}%;
			}
			.new-interface .card-more__box {
				padding-bottom: ${wide ? 95 : 150}%;
			}
			.new-interface .full-start__background-wrapper {
				position: absolute;
				top: 0;
				left: 0;
				width: 100%;
				height: 100%;
				z-index: -1;
				pointer-events: none;
			}
			.new-interface .full-start__background {
				position: absolute;
				height: 108%;
				width: 100%;
				top: -5em;
				left: 0;
				opacity: 0;
				object-fit: cover;
				transition: opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1);
			}
			.new-interface .full-start__background.active {
				opacity: 0.5;
			}
			.new-interface .full-start__rate {
				font-size: ${wide ? 1.3 : 1.2}em;
				margin-right: 0;
			}
			.new-interface .card__promo {
				display: none;
			}
			.new-interface .card.card--wide + .card-more .card-more__box {
				padding-bottom: 95%;
			}
			.new-interface .card.card--wide .card-watched {
				display: none !important;
			}
			body.light--version .new-interface-info__body {
				position: absolute;
				z-index: 9999999;
				width: 69%;
				padding-top: 1.5em;
			}
			body.light--version .new-interface-info {
				height: 25.3em;
			}
			body.advanced--animation:not(.no--animation) .new-interface .card.card--wide.focus .card__view {
				animation: animation-card-focus 0.2s;
			}
			body.advanced--animation:not(.no--animation) .new-interface .card.card--wide.animate-trigger-enter .card__view {
				animation: animation-trigger-enter 0.2s forwards;
			}
			body.advanced--animation:not(.no--animation) .new-interface .card.card--small.focus .card__view {
				animation: animation-card-focus 0.2s;
			}
			body.advanced--animation:not(.no--animation) .new-interface .card.card--small.animate-trigger-enter .card__view {
				animation: animation-trigger-enter 0.2s forwards;
			}
			.logo-moved-head { transition: opacity 0.4s ease; }
			.logo-moved-separator { transition: opacity 0.4s ease; }
			.items-line .card:not(.card--collection) .card__age,
			.items-line .card:not(.card--collection) .card__title {
				display: none !important;
			}
			${Lampa.Storage.get("hide_captions", true) ? ".new-interface-history .card:not(.card--collection) .card__age, .new-interface-history .card:not(.card--collection) .card__title { display: none !important; }" : ""}
				</style>`;
	}

	function getInfoUrl(data) {
		if (!data || !data.id) return "";
		var source = data.source || "tmdb";
		if (source !== "tmdb" && source !== "cub") return "";
		if (!Lampa.TMDB || typeof Lampa.TMDB.api !== "function" || typeof Lampa.TMDB.key !== "function") return "";

		var mediaType = data.media_type === "tv" || data.name ? "tv" : "movie";
		var language = Lampa.Storage.get("language") || "ru";
		return Lampa.TMDB.api(
			mediaType + "/" + data.id + "?api_key=" + Lampa.TMDB.key() +
			"&append_to_response=content_ratings,release_dates&language=" + language
		);
	}

	function requestInfo(apiUrl, callback) {
		if (globalInfoCache[apiUrl]) {
			if (callback) callback(globalInfoCache[apiUrl]);
			return;
		}

		if (pendingInfoRequests[apiUrl]) {
			if (callback) pendingInfoRequests[apiUrl].push(callback);
			return;
		}

		var callbacks = callback ? [callback] : [];
		pendingInfoRequests[apiUrl] = callbacks;
		var network = new Lampa.Reguest();
		network.timeout(callback ? 5000 : 30000);
		network.silent(apiUrl, function (response) {
			delete pendingInfoRequests[apiUrl];
			globalInfoCache[apiUrl] = response;
			callbacks.forEach(function (complete) {
				complete(response);
			});
		}, function () {
			delete pendingInfoRequests[apiUrl];
		});
	}

	function preloadData(data) {
		if (!data) return;
		if (data.card_id && data.card_type) {
			data = { id: data.card_id, media_type: data.card_type, source: "tmdb" };
		}
		var apiUrl = getInfoUrl(data);
		if (apiUrl) requestInfo(apiUrl);
	}

	function preloadAllVisibleCards() {
		if (!Lampa.Storage.get("async_load", true)) return;

		clearTimeout(preloadTimer);
		preloadTimer = setTimeout(function () {
			if (!Lampa.Storage.get("async_load", true)) return;
			var layer = $(".layer--visible");
			if (!layer.length) return;

			var cards = layer.find(".card");
			var shotCards = layer.find(".full-episode--shot");

			cards.each(function () {
				var data = findCardData(this);
				if (data) {
					preloadData(data);
				}
			});

			shotCards.each(function () {
				var $elem = $(this);

				var title = $elem.find(".card__title").text().trim();
				var year = $elem.find(".card__age").text().trim();

				if (title && year) {
					var isTV =
						$elem.find(".shots-tags div").filter(function () {
							return $(this)
								.text()
								.match(/^S-\d+$/);
						}).length > 0;

					var mediaType = isTV ? "tv" : "movie";
					var searchKey =
						"shots_search_" + JSON.stringify([title, year, mediaType, Lampa.Storage.get("language") || "ru"]);

					if (globalInfoCache[searchKey]) {
						return;
					}

					var language = Lampa.Storage.get("language") || "ru";
					var searchUrl = Lampa.TMDB.api(
						"search/" +
							mediaType +
							"?api_key=" +
							Lampa.TMDB.key() +
							"&query=" +
							encodeURIComponent(title) +
							"&year=" +
							year +
							"&language=" +
							language
					);

					globalInfoCache[searchKey] = true;

					var network = new Lampa.Reguest();
					network.silent(searchUrl, function (response) {
						if (response.results && response.results.length > 0) {
							var found = response.results[0];
							preloadData(
								{
									id: found.id,
									media_type: mediaType,
									name: mediaType === "tv" ? found.name : undefined,
									source: "tmdb"
								}
							);
						}
					}, function () {
						delete globalInfoCache[searchKey];
					});
				}
			});
		}, 800);
	}

	function setupPreloadObserver() {
		var observer = new MutationObserver(function (mutations) {
			if (!Lampa.Storage.get("async_load", true)) return;

			var hasNewCards = false;
			for (var i = 0; i < mutations.length; i++) {
				var added = mutations[i].addedNodes;
				for (var j = 0; j < added.length; j++) {
					var node = added[j];
					if (node.nodeType === 1) {
						if (
							node.classList.contains("card") ||
							node.querySelector(".card")
						) {
							hasNewCards = true;
							break;
						}
					}
				}
				if (hasNewCards) break;
			}

			if (hasNewCards) {
				preloadAllVisibleCards();
			}
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
	}

	function InfoPanel() {
		this.html = null;
		this.timer = null;
		this.lastRenderId = 0;
		this.logoRequest = null;
		this.currentUrl = null;
	}

	InfoPanel.prototype.create = function () {
		this.html = $(`<div class="new-interface-info">
							<div class="new-interface-info__body">
								<div class="new-interface-info__head"></div>
								<div class="new-interface-info__title"></div>
								<div class="new-interface-info__details"></div>
								<div class="new-interface-info__description"></div>
							</div>
						</div>`);
	};

	InfoPanel.prototype.render = function (asElement) {
		if (!this.html) this.create();
		return asElement ? this.html[0] : this.html;
	};

	InfoPanel.prototype.update = function (data) {
		if (!data || !this.html) return;

		var isShots = data.card_id && data.card_type;
		if (isShots) {
			data = {
				id: data.card_id,
				title: data.card_title,
				name: data.card_type === "tv" ? data.card_title : undefined,
				release_date: data.card_type === "movie" ? data.card_year : undefined,
				first_air_date: data.card_type === "tv" ? data.card_year : undefined,
				poster_path: data.card_poster,
				backdrop_path: data.img || data.screen,
				media_type: data.card_type,
				source: "tmdb"
			};
		}

		this.lastRenderId++;
		if (this.logoRequest) {
			this.logoRequest.abort();
			this.logoRequest = null;
		}
		var currentRenderId = this.lastRenderId;

		this.html
			.find(".new-interface-info__head,.new-interface-info__details")
			.removeClass("visible");

		var title = this.html.find(".new-interface-info__title");
		var desc = this.html.find(".new-interface-info__description");

		desc.text(data.overview || Lampa.Lang.translate("full_notext"));

		Lampa.Background.change(Lampa.Api.img(data.backdrop_path, "original"));

		this.load(data);

		title.text(data.title || data.name || "");
		title.css({ opacity: 1, height: "", display: "", transition: "" });
		if (Lampa.Storage.get("logo_show", true)) {
			this.showLogo(data, currentRenderId);
		}
	};

	InfoPanel.prototype.showLogo = function (data, renderId) {
		var _this = this;

		var FADE_OUT_TEXT = 300;
		var MORPH_HEIGHT = 400;
		var FADE_IN_IMG = 400;
		var TARGET_WIDTH = "7em";
		var PADDING_TOP_EM = 0;
		var PADDING_BOTTOM_EM = 0.2;

		var title_elem = this.html.find(".new-interface-info__title");
		var head_elem = this.html.find(".new-interface-info__head");
		var details_elem = this.html.find(".new-interface-info__details");
		var dom_title = title_elem[0];

		function applyFinalStyles(img, text_height) {
			img.style.marginTop = "0";
			img.style.marginLeft = "0";
			img.style.paddingTop = PADDING_TOP_EM + "em";
			img.style.paddingBottom = PADDING_BOTTOM_EM + "em";

			img.style.imageRendering = "-webkit-optimize-contrast";

			if (text_height) {
				img.style.height = text_height + "px";
				img.style.width = "auto";
				img.style.maxWidth = "100%";
				img.style.maxHeight = "none";
			} else if (window.innerWidth < 768) {
				img.style.width = "100%";
				img.style.height = "auto";
				img.style.maxWidth = "100%";
				img.style.maxHeight = "none";
			} else {
				img.style.width = TARGET_WIDTH;
				img.style.height = "auto";
				img.style.maxHeight = "none";
				img.style.maxWidth = "100%";
			}

			img.style.boxSizing = "border-box";
			img.style.display = "block";
			img.style.objectFit = "contain";
			img.style.objectPosition = "left bottom";
			img.style.transition = "none";
		}

		function moveHeadToDetails(animate) {
			if (!head_elem.length || !details_elem.length) return;
			if (details_elem.find(".logo-moved-head").length > 0) return;

			var content = head_elem.html();
			if (!content || content.trim() === "") return;

			var new_item = $('<span class="logo-moved-head">' + content + "</span>");
			var separator = $(
				'<span class="new-interface-info__split logo-moved-separator">●</span>'
			);

			if (animate) {
				new_item.css({ opacity: 0, transition: "none" });
				separator.css({ opacity: 0, transition: "none" });
			}

			if (details_elem.children().length > 0) details_elem.append(separator);
			details_elem.append(new_item);

			if (animate) {
				head_elem.css({
					transition: "opacity " + FADE_OUT_TEXT / 1000 + "s ease",
					opacity: "0"
				});

				setTimeout(function () {
					if (renderId !== _this.lastRenderId) return;
					new_item.css({
						transition: "opacity " + FADE_IN_IMG / 1000 + "s ease",
						opacity: "1"
					});
					separator.css({
						transition: "opacity " + FADE_IN_IMG / 1000 + "s ease",
						opacity: "1"
					});
				}, FADE_OUT_TEXT);
			} else {
				head_elem.css({ opacity: "0", transition: "none" });
			}
		}

		function startLogoAnimation(img_url, fromCache) {
			if (renderId && renderId !== _this.lastRenderId) return;

			var img = new Image();

			var start_text_height = 0;
			if (dom_title)
				start_text_height = dom_title.getBoundingClientRect().height;

			if (fromCache) {
				img.src = img_url;

				moveHeadToDetails(false);
				applyFinalStyles(img, start_text_height);

				title_elem.empty().append(img);
				title_elem.css({ opacity: "1", transition: "none" });

				if (dom_title) {
					dom_title.style.display = "block";
					dom_title.style.height = "";
					dom_title.style.transition = "none";
				}
				img.style.opacity = "1";
				return;
			}

			applyFinalStyles(img, start_text_height);
			img.style.opacity = "0";

			img.onload = function () {
				if (renderId && renderId !== _this.lastRenderId) return;

				setTimeout(function () {
					if (renderId && renderId !== _this.lastRenderId) return;

					if (dom_title)
						start_text_height = dom_title.getBoundingClientRect().height;

					moveHeadToDetails(true);

					title_elem.css({
						transition: "opacity " + FADE_OUT_TEXT / 1000 + "s ease",
						opacity: "0"
					});

					setTimeout(function () {
						if (renderId && renderId !== _this.lastRenderId) return;

						title_elem.empty();
						title_elem.append(img);
						title_elem.css({ opacity: "1", transition: "none" });

						var target_container_height =
							dom_title.getBoundingClientRect().height;

						dom_title.style.height = start_text_height + "px";
						dom_title.style.display = "block";
						dom_title.style.overflow = "hidden";
						dom_title.style.boxSizing = "border-box";

						void dom_title.offsetHeight;

						dom_title.style.transition =
							"height " +
							MORPH_HEIGHT / 1000 +
							"s cubic-bezier(0.4, 0, 0.2, 1)";

						requestAnimationFrame(function () {
							if (renderId && renderId !== _this.lastRenderId) return;
							dom_title.style.height = target_container_height + "px";

							setTimeout(
								function () {
									if (renderId && renderId !== _this.lastRenderId) return;
									img.style.transition =
										"opacity " + FADE_IN_IMG / 1000 + "s ease";
									img.style.opacity = "1";
								},
								Math.max(0, MORPH_HEIGHT - 100)
							);

							setTimeout(
								function () {
									if (renderId && renderId !== _this.lastRenderId) return;
									applyFinalStyles(img, start_text_height);
									dom_title.style.height = "";
								},
								MORPH_HEIGHT + FADE_IN_IMG + 50
							);
						});
					}, FADE_OUT_TEXT);
				}, 200);
			};

			img.onerror = function () {
				if (renderId !== _this.lastRenderId) return;
				title_elem.css({ opacity: "1", transition: "none" });
			};
			img.src = img_url;
		}

		if (data.id) {
			var type = data.media_type === "tv" || data.name ? "tv" : "movie";
			var language = Lampa.Storage.get("language") || "ru";
			var cache_key = "logo_cache_v2_" + type + "_" + data.id + "_" + language;
			var cached_url = Lampa.Storage.get(cache_key);

			if (cached_url === "none") return;

			if (cached_url) {
				var img_cache = new Image();
				img_cache.src = cached_url;

				if (img_cache.complete) {
					startLogoAnimation(cached_url, true);
				} else {
					startLogoAnimation(cached_url, false);
				}
			} else {
				var url = Lampa.TMDB.api(
					type +
						"/" +
						data.id +
						"/images?api_key=" +
						Lampa.TMDB.key() +
						"&include_image_language=" +
						language +
						",en,null"
				);

				this.logoRequest = $.get(url, function (data_api) {
					if (renderId && renderId !== _this.lastRenderId) return;

					var final_logo = null;
					if (data_api.logos && data_api.logos.length > 0) {
						for (var i = 0; i < data_api.logos.length; i++) {
							if (data_api.logos[i].iso_639_1 == language) {
								final_logo = data_api.logos[i].file_path;
								break;
							}
						}
						if (!final_logo) {
							for (var j = 0; j < data_api.logos.length; j++) {
								if (data_api.logos[j].iso_639_1 == "en") {
									final_logo = data_api.logos[j].file_path;
									break;
								}
							}
						}
						if (!final_logo) final_logo = data_api.logos[0].file_path;
					}

					if (final_logo) {
						var img_url = Lampa.TMDB.image(
							"/t/p/original" + final_logo.replace(".svg", ".png")
						);
						Lampa.Storage.set(cache_key, img_url);
						startLogoAnimation(img_url, false);
					} else {
						Lampa.Storage.set(cache_key, "none");
					}
				});
			}
		}
	};

	InfoPanel.prototype.load = function (data) {
		clearTimeout(this.timer);
		var apiUrl = getInfoUrl(data);
		this.currentUrl = apiUrl;
		if (!apiUrl) return;

		if (globalInfoCache[apiUrl]) {
			this.draw(globalInfoCache[apiUrl]);
			return;
		}

		var self = this;
		var renderId = this.lastRenderId;
		this.timer = setTimeout(function () {
			requestInfo(apiUrl, function (response) {
				if (self.html && self.currentUrl === apiUrl && self.lastRenderId === renderId) {
					self.draw(response);
				}
			});
		}, 300);
	};

	InfoPanel.prototype.draw = function (data) {
		if (!data || !this.html) return;

		if (data.overview) {
			this.html.find(".new-interface-info__description").text(data.overview);
		}

		var year = (
			(data.release_date || data.first_air_date || "0000") + ""
		).slice(0, 4);

		var rating = parseFloat((data.vote_average || 0) + "").toFixed(1);

		var headInfo = [];
		var detailsInfo = [];

		var countries = Lampa.Api.sources.tmdb.parseCountries(data);
		if (countries.length > 2) countries = countries.slice(0, 2);

		var ageRating = Lampa.Api.sources.tmdb.parsePG(data);

		if (Lampa.Storage.get("rat") !== false) {
			if (rating > 0) {
				var rate_style = "";

				if (Lampa.Storage.get("si_colored_ratings", true)) {
					var color = siStyleGetColorByRating(parseFloat(rating));

					if (color) rate_style = ' style="color: ' + color + '"';
				}

				detailsInfo.push(
					'<div class="full-start__rate"' +
						rate_style +
						"><div>" +
						rating +
						"</div><div>TMDB</div></div>"
				);
			}
		}

		if (Lampa.Storage.get("ganr") !== false) {
			if (data.genres && data.genres.length > 0) {
				detailsInfo.push(
					data.genres
						.slice(0, 2)
						.map(function (genre) {
							return Lampa.Utils.capitalizeFirstLetter(genre.name);
						})
						.join(" | ")
				);
			}
		}

		if (Lampa.Storage.get("vremya") !== false) {
			if (data.runtime) {
				detailsInfo.push(Lampa.Utils.secondsToTime(data.runtime * 60, true));
			}
		}

		if (Lampa.Storage.get("seas", false) && data.number_of_seasons) {
			detailsInfo.push(
				'<span class="full-start__pg" style="font-size: 0.9em;">Сезонов ' +
					data.number_of_seasons +
					"</span>"
			);
		}

		if (Lampa.Storage.get("eps", false) && data.number_of_episodes) {
			detailsInfo.push(
				'<span class="full-start__pg" style="font-size: 0.9em;">Эпизодов ' +
					data.number_of_episodes +
					"</span>"
			);
		}

		if (Lampa.Storage.get("year_ogr") !== false) {
			if (ageRating) {
				detailsInfo.push(
					'<span class="full-start__pg" style="font-size: 0.9em;">' +
						ageRating +
						"</span>"
				);
			}
		}

		if (Lampa.Storage.get("status") !== false) {
			var statusText = "";

			if (data.status) {
				switch (data.status.toLowerCase()) {
					case "released":
						statusText = "Выпущенный";
						break;
					case "ended":
						statusText = "Закончен";
						break;
					case "returning series":
						statusText = "Онгоинг";
						break;
					case "canceled":
						statusText = "Отменено";
						break;
					case "post production":
						statusText = "Скоро";
						break;
					case "planned":
						statusText = "Запланировано";
						break;
					case "in production":
						statusText = "В производстве";
						break;
					default:
						statusText = data.status;
						break;
				}
			}

			if (statusText) {
				detailsInfo.push(
					'<span class="full-start__status" style="font-size: 0.9em;">' +
						statusText +
						"</span>"
				);
			}
		}

		var yc = [];
		if (year !== "0000") yc.push("<span>" + year + "</span>");
		if (countries.length > 0) yc.push(countries.join(", "));

		if (yc.length > 0) {
			detailsInfo.push(yc.join(", "));
		}

		this.html
			.find(".new-interface-info__head")
			.empty()
			.append(headInfo.join(", "))
			.toggleClass("visible", headInfo.length > 0);
		this.html
			.find(".new-interface-info__details")
			.html(
				detailsInfo.join(
					'<span class="new-interface-info__split">&#9679;</span>'
				)
			)
			.addClass("visible");
	};

	InfoPanel.prototype.empty = function () {
		if (!this.html) return;
		clearTimeout(this.timer);
		this.currentUrl = null;
		this.html
			.find(".new-interface-info__head,.new-interface-info__details")
			.text("")
			.removeClass("visible");
	};

	InfoPanel.prototype.destroy = function () {
		clearTimeout(this.timer);
		this.lastRenderId++;
		if (this.logoRequest) this.logoRequest.abort();
		this.logoRequest = null;
		this.currentUrl = null;

		if (this.html) {
			this.html.remove();
			this.html = null;
		}
	};

	function siStyleGetColorByRating(vote) {
		if (isNaN(vote)) return "";
		if (vote >= 0 && vote <= 3) return "red";
		if (vote > 3 && vote < 6) return "orange";
		if (vote >= 6 && vote < 7) return "cornflowerblue";
		if (vote >= 7 && vote < 8) return "darkmagenta";
		if (vote >= 8 && vote <= 10) return "lawngreen";
		return "";
	}

	function siStyleApplyColorByRating(element) {
		var $el = $(element);
		var voteText = $el.text().trim();
		var colored = Lampa.Storage.get("si_colored_ratings", true);

		if (colored && /^\d+(\.\d+)?K$/.test(voteText)) return;

		var match = voteText.match(/(\d+(\.\d+)?)/);
		var vote = match ? parseFloat(match[0]) : NaN;
		var color = siStyleGetColorByRating(vote);

		if (color && colored) {
			$el.css("color", color);

			if (
				Lampa.Storage.get("si_rating_border", false) &&
				!$el.hasClass("card__vote")
			) {
				if ($el.parent().hasClass("full-start__rate")) {
					$el.parent().css("border", "1px solid " + color);
					$el.css("border", "");
				} else if (
					$el.hasClass("full-start__rate") ||
					$el.hasClass("full-start-new__rate") ||
					$el.hasClass("info__rate")
				) {
					$el.css("border", "1px solid " + color);
				} else {
					$el.css("border", "");
				}
			} else {
				$el.css("border", "");
				if ($el.parent().hasClass("full-start__rate")) {
					$el.parent().css("border", "");
				}
			}
		} else {
			$el.css("color", "");
			$el.css("border", "");
			if ($el.parent().hasClass("full-start__rate")) {
				$el.parent().css("border", "");
			}
		}
	}

	function siStyleUpdateVoteColors(root) {
		var scope = $(root || document.body);
		scope.find(ratingSelector).add(scope.filter(ratingSelector)).each(function () {
			siStyleApplyColorByRating(this);
		});
		scope.find(ratingGroupSelector).add(scope.filter(ratingGroupSelector)).each(function () {
			siStyleApplyColorByRating($(this).children("div").first());
		});
	}

	function siStyleSetupVoteColorsObserver() {
		siStyleUpdateVoteColors();

		var observer = new MutationObserver(function (mutations) {
			if (!Lampa.Storage.get("si_colored_ratings", true)) return;

			var roots = new Set();
			for (var i = 0; i < mutations.length; i++) {
				var mutation = mutations[i];
				var target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentNode;
				var rating = $(target).closest(ratingSelector + ", " + ratingGroupSelector)[0];
				if (rating) roots.add(rating);
				for (var j = 0; j < mutation.addedNodes.length; j++) {
					var node = mutation.addedNodes[j];
					if (node.nodeType === 1) roots.add(node);
				}
			}
			roots.forEach(function (root) {
				if (!document.body.contains(root)) return;
				for (var parent = root.parentNode; parent; parent = parent.parentNode) {
					if (roots.has(parent)) return;
				}
				siStyleUpdateVoteColors(root);
			});
		});

		observer.observe(document.body, {
			childList: true,
			characterData: true,
			subtree: true
		});
	}

	function siStyleSetupVoteColorsForDetailPage() {
		if (!window.Lampa || !Lampa.Listener) return;

		Lampa.Listener.follow("full", function (data) {
			if (data.type === "complite") {
				siStyleUpdateVoteColors();
			}
		});

		Lampa.Listener.follow("activity", function (e) {
			if (e.type === "active" || e.type === "start") {
				setTimeout(preloadAllVisibleCards, 1000);
			}
		});

		Lampa.Listener.follow("target", function (e) {
			if (e.target && $(e.target).hasClass("card")) {
				preloadAllVisibleCards();
			}
		});
	}

	function initializeSettings() {
		Lampa.Settings.listener.follow("open", function (event) {
			if (event.name == "main") {
				if (
					Lampa.Settings.main()
						.render()
						.find('[data-component="style_interface"]').length == 0
				) {
					Lampa.SettingsApi.addComponent({
						component: "style_interface",
						name: "Стильный интерфейс"
					});
				}

				Lampa.Settings.main().update();
				Lampa.Settings.main()
					.render()
					.find('[data-component="style_interface"]')
					.addClass("hide");
			}
		});

		Lampa.SettingsApi.addParam({
			component: "interface",
			param: {
				name: "style_interface",
				type: "static",
				default: true
			},
			field: {
				name: "Стильный интерфейс",
				description: "Настройки элементов"
			},
			onRender: function (item) {
				item.css("opacity", "0");
				requestAnimationFrame(function () {
					item.insertAfter($('div[data-name="interface_size"]'));
					item.css("opacity", "");
				});

				item.on("hover:enter", function () {
					Lampa.Settings.create("style_interface");
					Lampa.Controller.enabled().controller.back = function () {
						Lampa.Settings.create("interface");
					};
				});
			}
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "logo_show", type: "trigger", default: true },
			field: { name: "Показывать логотип вместо названия" }
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "show_background", type: "trigger", default: true },
			field: { name: "Отображать постеры на фоне" },
			onChange: function (value) {
				if (!value) {
					$(".full-start__background").removeClass("active");
				}
			}
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "status", type: "trigger", default: true },
			field: { name: "Показывать статус фильма/сериала" }
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "seas", type: "trigger", default: false },
			field: { name: "Показывать количество сезонов" }
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "eps", type: "trigger", default: false },
			field: { name: "Показывать количество эпизодов" }
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "year_ogr", type: "trigger", default: true },
			field: { name: "Показывать возрастное ограничение" }
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "vremya", type: "trigger", default: true },
			field: { name: "Показывать время фильма" }
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "ganr", type: "trigger", default: true },
			field: { name: "Показывать жанр фильма" }
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "rat", type: "trigger", default: true },
			field: { name: "Показывать рейтинг фильма" }
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "si_colored_ratings", type: "trigger", default: true },
			field: { name: "Цветные рейтинги" },
			onChange: function () {
				siStyleUpdateVoteColors();
			}
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "si_rating_border", type: "trigger", default: false },
			field: { name: "Обводка рейтингов" },
			onChange: function () {
				siStyleUpdateVoteColors();
			}
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "child_mode", type: "trigger", default: false },
			field: {
				name: "Детский режим",
				description: "Лампа будет перезагружена"
			},
			onChange: function () {
				window.location.reload();
			}
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "async_load", type: "trigger", default: true },
			field: { name: "Включить асинхронную загрузку данных" },
			onChange: function (value) {
				if (value) preloadAllVisibleCards();
			}
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: {
				name: "background_resolution",
				type: "select",
				default: "original",
				values: {
					w300: "w300",
					w780: "w780",
					w1280: "w1280",
					original: "original"
				}
			},
			field: {
				name: "Разрешение фона",
				description: "Качество загружаемых фоновых изображений"
			}
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "hide_captions", type: "trigger", default: true },
			field: {
				name: "Скрывать названия и год в истории просмотров",
				description: "Скрывает подписи под карточками только в истории просмотров. Лампа будет перезагружена"
			},
			onChange: function () {
				window.location.reload();
			}
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "wide_post", type: "trigger", default: true },
			field: {
				name: "Широкие постеры",
				description: "Лампа будет перезагружена"
			},
			onChange: function () {
				window.location.reload();
			}
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "disable_shots_plugin", type: "trigger", default: false },
			field: {
				name: "Отключить Shots",
				description: "Блокирует загрузку плагина Shots"
			},
			onChange: function () {
				window.location.reload();
			}
		});

		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "int_clear_logo_cache", type: "static" },
			field: {
				name: "Очистить кеш логотипов",
				description: "Лампа будет перезагружена"
			},
			onRender: function (item) {
				item.on("hover:enter", function () {
					Lampa.Select.show({
						title: "Очистить кеш логотипов?",
						items: [{ title: "Да", confirm: true }, { title: "Нет" }],
						onSelect: function (a) {
							if (a.confirm) {
								var keys = [];
								for (var i = 0; i < localStorage.length; i++) {
									var key = localStorage.key(i);
									if (key.indexOf("logo_cache_v2_") !== -1) {
										keys.push(key);
									}
								}
								keys.forEach(function (key) {
									localStorage.removeItem(key);
								});
								window.location.reload();
							} else {
								Lampa.Controller.toggle("settings_component");
							}
						},
						onBack: function () {
							Lampa.Controller.toggle("settings_component");
						}
					});
				});
			}
		});
	}

	function blockShotsPlugin() {
		if (!Lampa.Storage.get("disable_shots_plugin", false)) return;

		var patterns = ["plugin/shots", "plugin/shorts"];

		var isBlocked = function (url) {
			if (typeof url !== "string") return false;
			for (var i = 0; i < patterns.length; i++) {
				if (url.indexOf(patterns[i]) !== -1) return true;
			}
			return false;
		};

		["putScript", "putScriptAsync", "putScriptOfMirrors"].forEach(function (name) {
			if (typeof Lampa.Utils[name] !== "function") return;

			wrapMethod(Lampa.Utils, name, function (originalMethod, args) {
				var url = args[0];
				if (isBlocked(url)) {
					if (typeof args[1] === "function") args[1]();
					return;
				}
				if (Array.isArray(url)) {
					var filtered = url.filter(function (item) {
						return !isBlocked(item);
					});
					if (filtered.length !== url.length) {
						if (!filtered.length) {
							if (typeof args[1] === "function") args[1]();
							return;
						}
						args[0] = filtered;
					}
				}
				return originalMethod.apply(this, args);
			});
		});
	}
})();
