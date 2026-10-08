(function () {
	"use strict";

	var STORAGE_KEY_SERVER = "lamponline_server_url";
	var STORAGE_KEY_SERVERS = "lamponline_servers";
	var STORAGE_KEY_ACTIVE_SERVER = "lamponline_active_server";
	var STORAGE_KEY_SERVER_COUNTRIES = "lamponline_server_countries";
	var STORAGE_KEY_SERVER_TOKENS = "lamponline_server_tokens";
	var STORAGE_KEY_SERVER_UIDS = "lamponline_server_uids";
	var STORAGE_KEY_BWA = "bwaesgcmkey";
	var BWA_SERVER = "https://rc.bwa.ad";
	var bwaRevision = 0;
	var bwaImportCancel;
	var bwaStoredKey;

	function isBwaServer(url) {
		return typeof url === "string" && /^(?:https?:\/\/)?(?:rc\.)?bwa\.ad(?:\/(?:rc\/?)?)?$/i.test(url.trim());
	}

	function normalizeServerInput(url) {
		return typeof url === "string" ? (isBwaServer(url) ? BWA_SERVER : url.trim()) : "";
	}

	function getBwaKey() {
		var key = persistentGet(STORAGE_KEY_BWA, "");
		return typeof key === "string" ? key.trim() : "";
	}

	function validBwaKey(key) {
		return /^[A-Za-z0-9+/]{43}=$/.test(key);
	}

	function setBwaKey(key) {
		if (getBwaKey() === key) return;
		persistentSet(STORAGE_KEY_BWA, key);
		bwaKeyChanged();
	}

	function bwaKeyChanged() {
		if (bwaStoredKey === getBwaKey()) return;
		bwaStoredKey = getBwaKey();
		bwaRevision++;
		if (bwaImportCancel) bwaImportCancel(true);
		searchBalansersCache = Object.create(null);
		if (isBwaServer(getServerUrl())) {
			RchController.closeHost(getHostKey());
			ensureRchNws();
			var active = Lampa.Activity.active();
			if (active && active.component === "lamponline" && !$('body').hasClass('settings--open'))
				Lampa.Activity.replace({lampac_custom_select: ""});
		}
	}

	function serverRequest(network, method, url, success, error, data, options) {
		options = $.extend({}, options);
		var key = getBwaKey();
		if (validBwaKey(key) && isBwaServer(getServerUrl())) {
			try {
				var target = new URL(url, BWA_SERVER + "/");
				if (target.origin === BWA_SERVER) {
					url = target.href;
					options.headers = $.extend({}, options.headers, {"X-Kit-AesGcm": key});
				}
			} catch (e) {}
		}
		return network[method](url, success, error, data, options);
	}

	function bwaAccessMessage(error) {
		if (!isBwaServer(getServerUrl())) return "";
		if (!validBwaKey(getBwaKey())) return "Ключ BWA не задан или имеет неверный формат. Введите ключ AesGcm или ссылку привязки из bwa.ad/kit.";
		if (error && (error.status === 401 || error.status === 403))
			return "BWA отклонил доступ. Проверьте ключ AesGcm и настройки нужного источника в bwa.ad/kit.";
		return "";
	}

	function openBwaInput(callback) {
		var activity = Lampa.Activity.active();
		var controller = Lampa.Controller.enabled().name;
		function finish() {
			if (Lampa.Activity.active() !== activity) return;
			Lampa.Controller.toggle(controller);
			if (callback) callback();
		}
		Lampa.Input.edit({
			title: "Ключ AesGcm, ссылка привязки или код BWA",
			value: getBwaKey(),
			placeholder: "https://rc.bwa.ad/u/…",
			type: "password",
			nosave: true,
			free: true,
			nomic: true
		}, function (value) {
			if (Lampa.Activity.active() !== activity) return;
			if (value == null || !value.trim()) return finish();
			value = value.trim();
			function save(key) {
				setBwaKey(key);
				addServer(BWA_SERVER);
				var servers = getServersList();
				var index = servers.findIndex(function (server) { return isBwaServer(server); });
				setActiveServerIndex(index);
				Lampa.Noty.show("BWA добавлен. Ключ сохранён.");
				finish();
			}
			if (validBwaKey(value)) return save(value);
			var link = value.match(/^(?:https:\/\/)?rc\.bwa\.ad\/u\/([A-Za-z0-9_-]{1,64})\/?$/i);
			var code = link ? link[1] : /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "";
			if (!code) {
				Lampa.Noty.show("Введите полный ключ AesGcm из Kit, ссылку https://rc.bwa.ad/u/код или код из этой ссылки.");
				return finish();
			}
			if (bwaImportCancel) bwaImportCancel(true);
			var revision = bwaRevision;
			var network = new Lampa.Reguest();
			var settled = false;
			function complete(message, key, discard) {
				if (settled) return;
				settled = true;
				bwaImportCancel = null;
				network.clear();
				Lampa.Loading.stop();
				if (discard || revision !== bwaRevision || Lampa.Activity.active() !== activity) return;
				if (key) save(key);
				else {
					if (message) Lampa.Noty.show(message);
					finish();
				}
			}
			bwaImportCancel = function (discard) { complete(null, null, discard === true); };
			Lampa.Controller.toggle(controller);
			Lampa.Loading.start(bwaImportCancel);
			network.timeout(15000);
			network["native"](BWA_SERVER + "/u/" + encodeURIComponent(code), function (script) {
				var match = typeof script === "string" && script.length < 16384 &&
					script.match(/Lampa\s*\.\s*Storage\s*\.\s*set\s*\(\s*(['"])bwaesgcmkey\1\s*,\s*(['"])([A-Za-z0-9+/]{43}=)\2\s*(?:,\s*true\s*)?\)/);
				if (!match || !validBwaKey(match[3])) return complete("Ссылка привязки недействительна или истекла. Получите новую ссылку в bwa.ad/kit (она действует 20 минут) либо вставьте постоянный ключ AesGcm.");
				complete(null, match[3]);
			}, function (error) {
				complete(error && (error.status === 404 || error.status === 410)
					? "Ссылка привязки истекла или не найдена. Получите новую ссылку в bwa.ad/kit."
					: "Не удалось получить ключ BWA. Проверьте подключение и ссылку или вставьте постоянный ключ AesGcm из Kit.");
			}, false, {dataType: "text"});
		});
	}

	function initBwaSettings() {
		bwaStoredKey = getBwaKey();
		Lampa.Storage.listener.follow("change", function (event) {
			if (event.name === STORAGE_KEY_BWA) bwaKeyChanged();
		});
		Lampa.Settings.listener.follow("close", function () {
			if (bwaImportCancel) bwaImportCancel(true);
		});
		Lampa.SettingsApi.addParam({
			component: "lamponline_settings",
			param: {name: "lamponline_bwa", type: "static"},
			field: {
				name: "Добавить сервер BWA",
				description: "Введите ключ AesGcm из https://bwa.ad/kit или ссылку привязки https://rc.bwa.ad/u/код. Можно ввести только код. Ссылка действует 20 минут; сохранённый ключ остаётся на устройстве."
			},
			onRender: function (item) {
				item.find(".settings-param__name").text(getBwaKey() ? "BWA — изменить ключ / подключить" : "Добавить сервер BWA");
				item.on("hover:enter", function () { openBwaInput(function () { Lampa.Settings.update(); }); });
			}
		});
	}

	function persistentGet(key, defaultValue) {
		try {
			var value = Lampa.Storage.get(key);
			if (value === "") return defaultValue;
			return typeof value === "string" && value.charAt(0) === '"' ? JSON.parse(value) : value;
		} catch (e) {
			return defaultValue;
		}
	}

	function persistentSet(key, value) {
		if (value && typeof value === "object" && Object.getPrototypeOf(value) === null)
			value = JSON.parse(JSON.stringify(value));
		Lampa.Storage.set(key, value, true);
	}

	function parseStoredValue(value, defaultValue) {
		if (typeof value === "string") {
			try {
				return JSON.parse(value);
			} catch (e) {
				return defaultValue;
			}
		}
		return value;
	}

	function storedObject(value) {
		value = parseStoredValue(value, null);
		return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	}

	function getServerValues(key) {
		var values = storedObject(persistentGet(key, {}));
		var result = Object.create(null);
		Object.keys(values).forEach(function (name) {
			if (typeof values[name] === "string") result[name] = values[name];
		});
		return result;
	}

	function storageCache(key, limit, defaultValue) {
		try {
			var value = parseStoredValue(Lampa.Storage.cache(key, limit, defaultValue), defaultValue);
			return Array.isArray(defaultValue) ? (Array.isArray(value) ? value : []) : storedObject(value);
		} catch (e) {
			return defaultValue;
		}
	}

	function getClarificationSearch() {
		return storedObject(Lampa.Storage.get(Config.StorageKeys.ClarificationSearch, "{}"));
	}

	function clarificationSearchKey(movie) {
		return Lampa.Utils.hash(movie.number_of_seasons ? movie.original_name : movie.original_title);
	}

	function normalizeServerKey(url) {
		return typeof url === "string"
			? url.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase()
			: "";
	}

	var PERSISTENT_STORAGE_KEYS = [
		STORAGE_KEY_SERVER,
		STORAGE_KEY_SERVERS,
		STORAGE_KEY_ACTIVE_SERVER,
		STORAGE_KEY_SERVER_COUNTRIES,
		STORAGE_KEY_SERVER_TOKENS,
		STORAGE_KEY_SERVER_UIDS,
		STORAGE_KEY_BWA
	];

	function backupServerData() {
		var backup = {};
		PERSISTENT_STORAGE_KEYS.forEach(function (key) {
			var value = persistentGet(key, null);
			if (value !== null) backup[key] = value;
		});
		return backup;
	}

	function restoreServerData(backup) {
		if (!backup) return;
		PERSISTENT_STORAGE_KEYS.forEach(function (key) {
			if (Object.prototype.hasOwnProperty.call(backup, key)) persistentSet(key, backup[key]);
		});
	}

	function initClearProtection() {
		Lampa.Storage.listener.follow("clear", function () {
			var backup = backupServerData();
			setTimeout(function () {
				restoreServerData(backup);
			}, 0);
		});
	}

	function getServersList() {
		var servers = parseStoredValue(persistentGet(STORAGE_KEY_SERVERS, []), []);
		if (!Array.isArray(servers)) servers = [];
		servers = servers.filter(function (url) {
			return typeof url === "string" && !!url.trim();
		});
		var oldServer = persistentGet(STORAGE_KEY_SERVER, "");
		if (typeof oldServer === "string" && oldServer.trim() && servers.indexOf(oldServer) === -1) {
			servers.push(oldServer);
			persistentSet(STORAGE_KEY_SERVERS, servers);
		}
		return servers;
	}

	function getActiveServerIndex() {
		var servers = getServersList();
		var active = parseInt(persistentGet(STORAGE_KEY_ACTIVE_SERVER, 0), 10) || 0;
		if (active < 0 || active >= servers.length) active = 0;
		return active;
	}

	function setActiveServerIndex(index) {
		var previous = getServerUrl();
		persistentSet(STORAGE_KEY_ACTIVE_SERVER, index);
		ServerManager.changed(previous);
	}

	function addServer(url) {
		url = normalizeServerInput(url);
		if (typeof url !== "string" || !url.trim()) return false;
		var previous = getServerUrl();
		var servers = getServersList();
		if (!servers.some(function (server) { return normalizeServerInput(server) === url; })) {
			servers.push(url);
			persistentSet(STORAGE_KEY_SERVERS, servers);
			ServerManager.changed(previous);
			return true;
		}
		return false;
	}

	function removeServer(index) {
		var previous = getServerUrl();
		var servers = getServersList();
		if (typeof index === "number" && index % 1 === 0 && index >= 0 && index < servers.length) {
			var active = getActiveServerIndex();
			var removedUrl = servers[index];
			servers.splice(index, 1);
			persistentSet(STORAGE_KEY_SERVERS, servers);
			var oldServer = persistentGet(STORAGE_KEY_SERVER, "");
			if (oldServer === removedUrl) {
				persistentSet(STORAGE_KEY_SERVER, "");
			}
			if (index < active) active--;
			persistentSet(STORAGE_KEY_ACTIVE_SERVER, Math.max(0, Math.min(active, servers.length - 1)));
			setServerToken(removedUrl, "");
			setServerUid(removedUrl, "");
			ServerManager.changed(previous);
			return true;
		}
		return false;
	}

	function getServerCountries() {
		return getServerValues(STORAGE_KEY_SERVER_COUNTRIES);
	}

	function setServerCountry(url, country) {
		if (!url || !country) return;
		var normalized = normalizeServerKey(url);
		var countries = getServerCountries();
		countries[normalized] = country;
		persistentSet(STORAGE_KEY_SERVER_COUNTRIES, countries);
	}

	function getServerCountry(url) {
		if (!url) return "";
		var normalized = normalizeServerKey(url);
		var countries = getServerCountries();
		return countries[normalized] || "";
	}

	function getServerUrl() {
		var servers = getServersList();
		if (servers.length === 0) return "";
		var index = getActiveServerIndex();
		var url = servers[index] || "";
		return url ? Lampa.Utils.checkHttp(normalizeServerInput(url).replace(/\/+$/, ""), true) : "";
	}

	function getHostKey() {
		var url = getServerUrl();
		if (!url) return "";
		return url.replace(/^https?:\/\//, "");
	}

	function isServerConfigured() {
		return Boolean(getServerUrl());
	}

	function safeUiText(value) {
		var element = document.createElement("span");
		element.textContent = value == null ? "" : String(value);
		return element.innerHTML;
	}

	function formatServerDisplay(url) {
		if (isBwaServer(url)) return "BWA (rc.bwa.ad)";
		var displayName = (typeof url === "string" ? url : "").replace(/^https?:\/\//, "");
		var country = getServerCountry(url);
		if (country) {
			return displayName + " (" + country + ")";
		}
		return displayName;
	}

	function getCurrentServerDisplay() {
		var server = getServersList()[getActiveServerIndex()];
		return server ? formatServerDisplay(server) : Lampa.Lang.translate("lampac_not_set");
	}

	function getServerTokens() {
		return getServerValues(STORAGE_KEY_SERVER_TOKENS);
	}

	function getServerToken(serverUrl) {
		var tokens = getServerTokens();
		return tokens[serverUrl] || "";
	}

	function setServerToken(serverUrl, token) {
		if (!serverUrl) return;
		var tokens = getServerTokens();
		if (token) {
			tokens[serverUrl] = token;
		} else {
			delete tokens[serverUrl];
		}
		persistentSet(STORAGE_KEY_SERVER_TOKENS, tokens);
	}

	function getCurrentServerToken() {
		var serverUrl = getServerUrl();
		if (!serverUrl) return "";
		var servers = getServersList();
		var activeIndex = getActiveServerIndex();
		var originalUrl = servers[activeIndex] || "";
		return getServerToken(originalUrl);
	}

	function getServerUids() {
		return getServerValues(STORAGE_KEY_SERVER_UIDS);
	}

	function getServerUid(serverUrl) {
		var uids = getServerUids();
		return uids[serverUrl] || "";
	}

	function setServerUid(serverUrl, uid) {
		if (!serverUrl) return;
		var uids = getServerUids();
		if (uid) {
			uids[serverUrl] = uid;
		} else {
			delete uids[serverUrl];
		}
		persistentSet(STORAGE_KEY_SERVER_UIDS, uids);
	}

	function getCurrentServerUid() {
		var serverUrl = getServerUrl();
		if (!serverUrl) return "";
		var servers = getServersList();
		var activeIndex = getActiveServerIndex();
		var originalUrl = servers[activeIndex] || "";
		return getServerUid(originalUrl);
	}

	var Config = {
		Urls: {
			getLocalhost: function () {
				var url = getServerUrl();
				return url ? url + "/" : "";
			},
			getLampOnline: function () {
				return getServerUrl();
			},
			NwsClientScript:
				"https://ipavlin98.github.io/lmp-plugins/nws-client-es5.js",
			GithubCheck: "https://github.com/",
			CorsCheckPath: "/cors/check"
		},
		Rch: {
			RegistryVersion: 149,
			ClientTimeout: 8000,
			ConnectionTimeout: 40000
		},
		StorageKeys: {
			LampacUnicId: "lampac_unic_id",
			LampacProfileId: "lampac_profile_id",
			ClarificationSearch: "clarification_search",
			OnlineLastBalanser: "online_last_balanser",
			OnlineBalanser: "online_balanser",
			ActiveBalanser: "active_balanser",
			OnlineChoicePrefix: "online_choice_",
			OnlineHlsPrefix: "lamponline_hls_",
			OnlineWatchedLast: "online_watched_last",
			OnlineView: "online_view"
		}
	};

	var searchBalansersCache = Object.create(null);

	function ensureBalansersWithSearch() {
		if (!isServerConfigured()) return Promise.resolve([]);
		var url = account(Config.Urls.getLocalhost() + "lite/withsearch");
		if (!searchBalansersCache[url]) {
			searchBalansersCache[url] = new Promise(function (resolve, reject) {
				var net = new Lampa.Reguest();
				net.timeout(10000);
				serverRequest(net, "silent", url, function (json) {
					resolve(Array.isArray(json) ? json : []);
				}, reject);
			})["catch"](function (error) {
				delete searchBalansersCache[url];
				console.error(error);
				return [];
			});
		}
		return searchBalansersCache[url];
	}

	if (!window.rch_nws) window.rch_nws = {};

	function ensureRchNws() {
		var hostkey = getHostKey();
		if (!hostkey) return null;
		if (!window.rch_nws[hostkey]) {
			window.rch_nws[hostkey] = {
				type: Lampa.Platform.is("android")
					? "apk"
					: Lampa.Platform.is("tizen")
						? "cors"
						: undefined,
				startTypeInvoke: false,
				rchRegistry: false,
				apkVersion: 0
			};
		}
		var serverUrl = Config.Urls.getLampOnline();
		if (typeof window.rch_nws[hostkey].typeInvoke !== "function") {
			var typePromise;
			window.rch_nws[hostkey].typeInvoke = function rchtypeInvoke(host, call) {
				var hk = hostkey;
				if (!typePromise) typePromise = new Promise(function (resolve) {
					window.rch_nws[hk].startTypeInvoke = true;
					var state = window.rch_nws[hk];
					var check = function check(good) {
						if (window.rch_nws[hk] !== state) { resolve(); return; }
						window.rch_nws[hk].type = Lampa.Platform.is("android")
							? "apk"
							: good
								? "cors"
								: "web";

						resolve();
					};
					if (Lampa.Platform.is("android") || Lampa.Platform.is("tizen"))
						check(true);
					else {
						var net = new Lampa.Reguest();
						net.silent(
							serverUrl.indexOf(location.host) >= 0
								? Config.Urls.GithubCheck
								: host + Config.Urls.CorsCheckPath,
							function () {
								check(true);
							},
							function () {
								check(false);
							},
							false,
							{ dataType: "text" }
						);
					}
				});
				typePromise.then(call);
			};
		}

		if (typeof window.rch_nws[hostkey].Registry !== "function") {
			window.rch_nws[hostkey].Registry = function RchRegistry(
				client,
				startConnection,
				onError
			) {
				var hk = hostkey;
				new Promise(function (resolve) {
					window.rch_nws[hk].typeInvoke(serverUrl, resolve);
				})
					.then(function () {
						if (client !== RchController.getClient()) throw new Error("Активный RCH-клиент изменён");
						if (onError && (!client.socket || client.socket.readyState !== WebSocket.OPEN)) throw new Error("Соединение RCH закрыто");
						client.invoke(
							"RchRegistry",
							JSON.stringify({
								version: Config.Rch.RegistryVersion,
								host: location.host,
								rchtype: Lampa.Platform.is("android")
									? "apk"
									: Lampa.Platform.is("tizen")
										? "cors"
										: window.rch_nws[hk].type,
								apkVersion: window.rch_nws[hk].apkVersion,
								player: Lampa.Storage.field("player")
							})
						);

						if (client._shouldReconnect && window.rch_nws[hk].rchRegistry) {
							if (startConnection) startConnection();
							return;
						}
						window.rch_nws[hk].rchRegistry = true;
						window.rch_nws[hk].connectionId = client.connectionId;

						client.on("RchRegistry", function (clientIp) {
							if (startConnection) startConnection();
						});

						client.on(
							"RchClient",
							function (rchId, url, data, headers, returnHeaders) {
								if (client !== RchController.getClient()) return;
								var network = new Lampa.Reguest();
								var requests = window.rch_nws[hk].requests || (window.rch_nws[hk].requests = []);
								requests.push(network);
								function result(html) {
									var index = requests.indexOf(network);
									if (index >= 0) requests.splice(index, 1);
									if (client !== RchController.getClient()) return;
									if (
										Lampa.Arrays.isObject(html) ||
										Lampa.Arrays.isArray(html)
									) {
										html = JSON.stringify(html);
									}
									client.invoke("RchResult", rchId, html);
								}
								if (url == "eval") {
									result("");
								} else if (url == "ping") result("pong");
								else {
									network["native"](
										url,
										result,
										function () {
											result("");
										},
										data,
										{
											dataType: "text",
											timeout: Config.Rch.ClientTimeout,
											headers: headers,
											returnHeaders: returnHeaders
										}
									);
								}
							}
						);

						client.on("Connected", function (connectionId) {
							if (client === RchController.getClient() && window.rch_nws[hk]) window.rch_nws[hk].connectionId = connectionId;
						});
					})
					["catch"](function (e) {
						console.error(e);
						if (onError) onError(e);
						else if (startConnection) startConnection();
					});
			};
		}
		return window.rch_nws[hostkey];
	}

	var domParser = null;

	var lamponline_css_inited = false;

	var RchController = (function () {
		var script_promise;
		var connections = Object.create(null);

		function closeHost(host) {
			var entry = connections[host];
			var client = window.nwsClient && window.nwsClient[host];
			var state = window.rch_nws[host];
			if (state && state.requests) state.requests.forEach(function (request) { request.clear(); });
			delete connections[host];
			if (entry && entry.cancel) entry.cancel(new Error("Активный сервер изменён"));
			if (client) client.close();
			if (window.nwsClient) delete window.nwsClient[host];
			delete window.rch_nws[host];
		}

		function getClient() {
			var hostkey = getHostKey();
			return hostkey && window.nwsClient && window.nwsClient[hostkey]
				? window.nwsClient[hostkey]
				: null;
		}

		function loadClientScript() {
			if (typeof NativeWsClient === "function") return Promise.resolve();
			if (script_promise) return script_promise;

			script_promise = new Promise(function (resolve, reject) {
				Lampa.Utils.putScript(
					[Config.Urls.NwsClientScript],
					function () {
						if (typeof NativeWsClient === "function") resolve();
						else reject(new Error("Не удалось загрузить RCH-клиент"));
					},
					function () { reject(new Error("Ошибка загрузки RCH-клиента")); },
					false,
					true
				);
			})["catch"](function (error) {
				script_promise = null;
				throw error;
			});

			return script_promise;
		}

		function connect(json) {
			var hostkey = getHostKey();
			if (!hostkey) return Promise.reject(new Error("Сервер не настроен"));
			if (!json || typeof json.nws !== "string" || !json.nws) return Promise.reject(new Error("Сервер не вернул адрес RCH"));
			var pending = connections[hostkey];
			if (pending && pending.url === json.nws && (!pending.client ||
				(pending.client === getClient() && pending.client.socket && pending.client.socket.readyState < WebSocket.CLOSING))) return pending.promise;
			ensureRchNws();
			var entry = {url: json.nws, client: null};
			connections[hostkey] = entry;
			entry.promise = loadClientScript().then(function () {
				return new Promise(function (resolve, reject) {
					var client, timer, settled = false;
					entry.cancel = fail;
					function fail(error) {
						if (connections[hostkey] === entry) delete connections[hostkey];
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						if (client) client.close();
						reject(error);
					}
					try {
						if (hostkey !== getHostKey() || connections[hostkey] !== entry) return fail(new Error("Активный сервер изменён"));
						var previous = getClient();
						if (previous && previous._shouldReconnect && previous.socket && previous.socket.readyState === WebSocket.OPEN && previous.connectionId) {
							entry.client = previous;
							delete connections[hostkey];
							return resolve(previous);
						}
						if (previous && typeof previous.close === "function") previous.close();
						else if (previous && previous.socket) previous.socket.close();
						if (!window.nwsClient) window.nwsClient = {};
						client = new NativeWsClient(json.nws, {
							autoReconnect: false,
							onError: function () { fail(new Error("Ошибка подключения RCH")); },
							onClose: function () { fail(new Error("Соединение RCH закрыто")); }
						});
						entry.client = client;
						window.nwsClient[hostkey] = client;
						client.on("Connected", function () {
							if (settled) return;
							window.rch_nws[hostkey].Registry(client, function () {
								if (settled) return;
								if (hostkey !== getHostKey() || connections[hostkey] !== entry) return fail(new Error("Активный сервер изменён"));
								settled = true;
								clearTimeout(timer);
								resolve(client);
							}, fail);
						});
						timer = setTimeout(function () { fail(new Error("Время ожидания RCH истекло")); }, Config.Rch.ConnectionTimeout);
						client.connect();
					} catch (e) {
						fail(e);
					}
				});
			})["catch"](function (error) {
				if (connections[hostkey] === entry) delete connections[hostkey];
				throw error;
			});
			return entry.promise;
		}

		return {
			closeHost: closeHost,
			connect: connect,
			getClient: getClient
		};
	})();

	var ServerManager = {
		changed: function (previous) {
			if (previous === getServerUrl()) return;
			RchController.closeHost(previous.replace(/^https?:\/\//, ""));
			ensureRchNws();
			var active = Lampa.Activity.active();
			if (active && active.component === "lamponline" && !$('body').hasClass('settings--open'))
				Lampa.Activity.replace({lampac_custom_select: ""});
		}
	};

	function rchRun(json, call, onError) {
		return RchController.connect(json)
			.then(function (client) {
				if (client !== RchController.getClient()) throw new Error("Активный RCH-клиент изменён");
				call();
			})
			["catch"](function (e) {
				console.error(e);
				if (onError) onError(e);
			});
	}

	function hasUrlParameter(url, name) {
		var queryStart = url.indexOf("?");
		if (queryStart < 0) return false;
		return url.slice(queryStart + 1).split("&").some(function (part) {
			return part.split("=")[0] === name;
		});
	}

	function buildUrl(url, query) {
		url = String(url);
		var hashIndex = url.indexOf("#");
		var hash = hashIndex < 0 ? "" : url.slice(hashIndex);
		if (hashIndex >= 0) url = url.slice(0, hashIndex);
		if (query && query.length) url = Lampa.Utils.addUrlComponent(url, query.join("&"));
		var endpoint = getServerUrl();
		try {
			if (!endpoint) return url + hash;
			var parsed = new URL(url, endpoint + "/");
			if (parsed.origin !== new URL(endpoint).origin) return url + hash;
			url = parsed.href;
		} catch (e) {
			return url + hash;
		}

		if (!hasUrlParameter(url, "uid")) {
			var uid = getCurrentServerUid() || Lampa.Storage.get("lampac_unic_id", "") || "guest";
			url = Lampa.Utils.addUrlComponent(url, "uid=" + encodeURIComponent(uid));
		}

		if (!hasUrlParameter(url, "nws_id")) {
			var nwsId = Lampa.Storage.get("lampac_nws_id", "");
			if (nwsId) url = Lampa.Utils.addUrlComponent(url, "nws_id=" + encodeURIComponent(nwsId));
		}

		var email = Lampa.Storage.get("account_email", "");
		if (email && !hasUrlParameter(url, "account_email")) {
			url = Lampa.Utils.addUrlComponent(url, "account_email=" + encodeURIComponent(email));
		}
		if (email && !hasUrlParameter(url, "cub_id")) {
			url = Lampa.Utils.addUrlComponent(url, "cub_id=" + encodeURIComponent(Lampa.Utils.hash(email)));
		}

		var serverToken = getCurrentServerToken();
		new URLSearchParams(serverToken.replace(/^[?&]/, "")).forEach(function (value, key) {
			if (key && !hasUrlParameter(url, encodeURIComponent(key))) {
				url = Lampa.Utils.addUrlComponent(url, encodeURIComponent(key) + "=" + encodeURIComponent(value));
			}
		});
		return url + hash;
	}

	function account(url) {
		return buildUrl(url);
	}

	function formatCardInfo(info, wrap) {
		if (!info || !info.length) return "";
		var fragment = document.createDocumentFragment();
		info.forEach(function (value, index) {
			if (index) {
				var split = document.createElement("span");
				split.className = "online-prestige-split";
				split.textContent = "●";
				fragment.appendChild(split);
			}
			var node = value instanceof Node ? value : document.createTextNode(String(value));
			if (wrap) {
				var span = document.createElement("span");
				span.appendChild(node);
				node = span;
			}
			fragment.appendChild(node);
		});
		return fragment;
	}

	var REZKA_SOURCE = 'rezka_local';
	var rezkaSession = null;
	var rezkaSerial = 0;
	var rezkaSettingsReady = false;

	function rezkaDocument(html) {
		return new DOMParser().parseFromString(String(html || ''), 'text/html');
	}

	function rezkaText(node) {
		return node ? String(node.textContent || '').trim() : '';
	}

	function rezkaMessage(html) {
		var doc = rezkaDocument(html);
		Array.prototype.forEach.call(doc.querySelectorAll('script, style'), function (node) {
			node.parentNode.removeChild(node);
		});
		return rezkaText(doc.body).slice(0, 500);
	}

	function rezkaAddress(value, proxy) {
		value = String(value || '').trim();
		if (!value && proxy) return '';
		if (!value) value = 'https://kvk.zone';
		if (value.indexOf('://') === -1) value = 'https://' + value;
		var link = document.createElement('a');
		link.href = value;
		var localProxy = proxy && link.protocol === 'http:' &&
			/^(10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/.test(link.hostname) &&
			link.hostname.split('.').every(function (part) { return Number(part) <= 255; });
		if ((link.protocol !== 'https:' && !localProxy) ||
			!link.hostname || link.username || link.password ||
			link.search || link.hash || /[\s\\]/.test(value) ||
			(!proxy && link.pathname !== '/' && link.pathname !== '')) {
			throw new Error(proxy ? 'Укажите доверенный HTTPS-прокси или HTTP-прокси в локальной сети без логина, query и фрагмента.' : 'Укажите HTTPS-адрес зеркала без пути, логина и параметров.');
		}
		return (link.protocol + '//' + link.host + (proxy ? link.pathname : '')).replace(/\/+$/, '') + (proxy ? '/' : '');
	}

	function rezkaContext() {
		var host = rezkaAddress(Lampa.Storage.get(REZKA_SOURCE + '_mirror', ''), false);
		var proxy = rezkaAddress(Lampa.Storage.get(REZKA_SOURCE + '_proxy', ''), true);
		var android = Lampa.Platform.is('android');
		var key = JSON.stringify([host, proxy, android ? 'native' : 'browser']);
		if (!rezkaSession || rezkaSession.key !== key) {
			var saved = Lampa.Storage.get(REZKA_SOURCE + '_session', {});
			rezkaSession = {
				key: key, serial: ++rezkaSerial, host: host, proxy: proxy, android: android,
				cookie: saved && saved.key === key ? String(saved.cookie || '') : '', confirmed: false,
				userId: saved && saved.key === key ? String(saved.userId || '') : '',
				email: saved && saved.key === key ? String(saved.email || '') : '', premiumDays: null
			};
		}
		return rezkaSession;
	}

	function rezkaAuthorized() {
		try { return rezkaContext().confirmed === true; }
		catch (e) { return false; }
	}

	function rezkaRemember(ctx) {
		if (ctx === rezkaSession && ctx.confirmed) {
			Lampa.Storage.set(REZKA_SOURCE + '_session', {key: ctx.key, cookie: ctx.cookie, userId: ctx.userId, email: ctx.email});
		}
	}

	function rezkaForget(ctx) {
		ctx.confirmed = false;
		ctx.cookie = '';
		ctx.userId = '';
		ctx.email = '';
		ctx.premiumDays = null;
		if (ctx === rezkaSession) Lampa.Storage.set(REZKA_SOURCE + '_session', {});
	}

	function rezkaPageUrl(value, ctx) {
		value = String(value || '').trim();
		if (value.indexOf('//') === 0) value = 'https:' + value;
		else if (value.charAt(0) === '/') value = ctx.host + value;
		var link = document.createElement('a');
		link.href = value;
		if (!/^https:\/\//i.test(value) || link.protocol + '//' + link.host !== ctx.host ||
			link.username || link.password || /[\s\\]/.test(value)) {
			throw new Error('Страница должна принадлежать выбранному HTTPS-зеркалу Rezka. Сначала измените зеркало в настройках.');
		}
		return link.href.split('#')[0];
	}

	function rezkaCookies(ctx, headers) {
		var values = Object.create(null);
		String(ctx.cookie || '').split(/;\s*/).forEach(function (part) {
			var pos = part.indexOf('=');
			if (pos > 0) values[part.slice(0, pos)] = part.slice(pos + 1);
		});
		Object.keys(headers || {}).forEach(function (name) {
			if (name.toLowerCase() !== 'set-cookie') return;
			var lines = headers[name];
			if (!Array.isArray(lines)) lines = String(lines || '').split(/\r?\n|,(?=\s*[^\s;,=]+=)/);
			lines.forEach(function (line) {
				var pair = String(line).split(';')[0].trim();
				var pos = pair.indexOf('=');
				if (pos < 1 || /[\r\n]/.test(pair)) return;
				var key = pair.slice(0, pos), value = pair.slice(pos + 1);
				var expires = String(line).match(/;\s*expires=([^;]+)/i);
				if (value === 'deleted' || /;\s*max-age=0(?:;|$)/i.test(line) ||
					(expires && Date.parse(expires[1]) <= Date.now())) delete values[key];
				else values[key] = value;
			});
		});
		ctx.cookie = Object.keys(values).map(function (name) { return name + '=' + values[name]; }).join('; ');
		rezkaRemember(ctx);
	}

	function rezkaLost(body) {
		if (body && typeof body === 'object') {
			return body.need_login === true || body.login_required === true ||
				/(?:необходима|требуется) авторизация|(?:необходимо|нужно) (?:войти|авторизоваться)|вы не авторизованы|авторизуйтесь|сессия истекла|срок.*сессии.*ист[её]к/i.test(rezkaMessage(body.message || body.error || ''));
		}
		var doc = rezkaDocument(body);
		return !!doc.querySelector('form#check-form[action*="/ajax/login/"]') ||
			(!doc.querySelector('a[href*="/logout/"]') && !!doc.querySelector('.b-tophead__login'));
	}

	function rezkaHtmlError(body) {
		var doc = rezkaDocument(body);
		var problem = doc.querySelector('.error-title, .b-player__restricted__block_message');
		if (problem) return rezkaText(problem) || 'Просмотр ограничен на стороне Rezka.';
		if (/^\s*Fatal error:/i.test(body)) return 'Ошибка на стороне зеркала Rezka.';
		if (doc.querySelector('button[onclick*="$.cookie"]') && /MIRROR/.test(body)) {
			return 'Зеркало требует проверки JavaScript. Пройдите её на сайте и проверьте cookie либо выберите другое зеркало.';
		}
		return '';
	}

	function rezkaRequest(network, ctx, url, data, json, alive, success, error) {
		var headers = {}, target, requestData, wrapped = !!(ctx.proxy || ctx.android);
		var localProxy = ctx.proxy.indexOf('http://') === 0;
		try {
			target = rezkaPageUrl(url, ctx);
			requestData = data && typeof data === 'object' ? $.param(data) : data || false;
			var agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
			if (localProxy) {
				requestData = $.param({payload: JSON.stringify({
					url: target,
					method: requestData ? 'POST' : 'GET',
					body: requestData || '',
					headers: {
						'User-Agent': agent,
						Cookie: ctx.cookie || ''
					}
				})});
				target = ctx.proxy + 'request';
			} else if (ctx.proxy) {
				var params = 'param/Origin=' + encodeURIComponent(ctx.host) + '/param/Referer=' + encodeURIComponent(ctx.host + '/') +
					'/param/User-Agent=' + encodeURIComponent(agent) + '/cookie_plus/param/Cookie=' + encodeURIComponent(ctx.cookie) + '/';
				var name = target.split('?')[0].split('/').pop().replace(/\.(php|asp|aspx|jsp|cgi|pl|py|rb)$/, '.txt');
				target = ctx.proxy + 'enc2/' + encodeURIComponent(btoa(params + target)) + '/' + name + '?jacred.test';
			} else if (ctx.android) {
				headers = {'Origin': ctx.host, 'Referer': ctx.host + '/', 'User-Agent': agent};
				if (ctx.cookie) headers.Cookie = ctx.cookie;
			}
		} catch (e) { if (alive()) error(e.message); return; }
		if (!alive()) return;
		network.timeout(localProxy ? 30000 : 15000);
		network[ctx.android ? 'native' : 'silent'](target, function (response) {
			if (!alive()) return;
			var body = response, issue = '';
			try {
				if (wrapped) {
					var envelope = typeof response === 'string' ? JSON.parse(response) : response;
					if (!envelope || !Object.prototype.hasOwnProperty.call(envelope, 'body')) {
						throw new Error('Неверный формат ответа: проверьте адрес и совместимость прокси; для прямого подключения нужен Android Lampa 339+.');
					}
					rezkaCookies(ctx, envelope.headers);
					body = envelope.body;
					var status = Number(envelope.status || envelope.statusCode || 0);
					if (status >= 400) issue = 'Rezka: HTTP ' + status;
				}
				if (json && typeof body === 'string' && /^\s*[\[{]/.test(body)) body = JSON.parse(body);
				if (url !== ctx.host + '/logout/' && (rezkaLost(body) || (!ctx.proxy && status === 401))) {
					rezkaForget(ctx);
					issue = 'Сессия Rezka истекла. Выполните вход в настройках Онлайн.';
				} else if (typeof body === 'string') issue = rezkaHtmlError(body) || issue;
				if (!issue && json && (!body || typeof body !== 'object')) issue = 'Rezka вернула страницу вместо JSON. Проверьте зеркало и вход.';
			} catch (e) { issue = e.message || 'Не удалось разобрать ответ Rezka.'; }
			if (issue) error(issue); else success(body);
		}, function (xhr, status) {
			if (!alive()) return;
			var body = xhr && xhr.responseText || '';
			try {
				if (/^\s*\{/.test(body)) body = JSON.parse(body);
				if (wrapped && body && Object.prototype.hasOwnProperty.call(body, 'body')) {
					body = body.body;
					if (typeof body === 'string' && /^\s*\{/.test(body)) body = JSON.parse(body);
				}
			} catch (e) {}
			if (rezkaLost(body) || (!ctx.proxy && xhr && xhr.status === 401)) {
				rezkaForget(ctx);
				error('Сессия Rezka истекла. Выполните вход в настройках Онлайн.');
			} else {
				error('Не удалось связаться с Rezka' + (xhr && xhr.status ? ' (HTTP ' + xhr.status + ')' : '') +
					(status === 'timeout' ? ': время ожидания истекло.' : '. Проверьте зеркало, сеть и CORS; в браузере может потребоваться доверенный прокси.'));
			}
		}, requestData, {
			dataType: 'text', headers: headers, withCredentials: !ctx.proxy && !ctx.android,
			returnHeaders: ctx.android && !ctx.proxy
		});
	}

	function rezkaVerify(network, ctx, alive, success, error) {
		rezkaRequest(network, ctx, ctx.host + '/', false, false, alive, function (html) {
			var doc = rezkaDocument(html);
			var confirmed = Array.prototype.some.call(doc.querySelectorAll('a[href]'), function (node) {
				try { return /\/logout\/(?:\?|$)/.test(rezkaPageUrl(node.getAttribute('href'), ctx)); }
				catch (e) { return false; }
			});
			if (!confirmed) {
				rezkaForget(ctx);
				error('Вход Rezka не подтверждён: сайт не вернул ссылку выхода. Выполните вход или проверьте зеркало и cookie.');
				return;
			}
			ctx.confirmed = true;
			var premium = doc.querySelector('.b-tophead-premuser');
			var premiumText = premium ? String(premium.innerHTML || premium.textContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
			if (!premiumText) premiumText = rezkaText(premium);
			var days = premiumText.match(/(?:^|\s)(\d+)\s*(?:дней|день|дня|днів|дні|дн\.?|days?)(?=\s|$|[.,;:!?)])/i);
			ctx.premiumDays = days ? Number(days[1]) : (doc.querySelector('body.b-premium_user__body') || premium ? null : 0);
			var member = doc.querySelector('#member_user_id');
			var userId = member ? member.value.trim() : '';
			function complete() {
				rezkaRemember(ctx);
				success();
			}
			if (ctx.email && userId && ctx.userId === userId) { complete(); return; }
			ctx.userId = userId;
			ctx.email = '';
			var profile = /^\d+$/.test(userId) ? '/user/' + userId + '/' : '/settings/';
			rezkaRequest(network, ctx, ctx.host + profile, false, false, alive, function (html) {
				var email = rezkaDocument(html).querySelector('form#userinfo input[name="email"]');
				if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) ctx.email = email.value.trim();
				complete();
			}, function (message) {
				if (ctx.confirmed) complete(); else error(message);
			});
		}, error);
	}

	function initRezkaSettings() {
		if (rezkaSettingsReady) return;
		rezkaSettingsReady = true;
		var network = new Lampa.Reguest(), revision = 0, settingsBody, activeStatus, statusTimer;
		function refresh() {
			if (!settingsBody) return;
			var ctx;
			try { ctx = rezkaContext(); } catch (e) {}
			var saved = Lampa.Storage.get(REZKA_SOURCE + '_session', {});
			var cookies = ctx && (ctx.android || ctx.proxy);
			settingsBody.find('.rezka-account-state').text(!ctx ? 'Проверьте адрес зеркала и прокси' : ctx.confirmed ? 'Вы вошли в аккаунт' : saved && saved.key === ctx.key ? 'Проверяем вход…' : 'Вход не выполнен');
			settingsBody.find('.rezka-account-email').text(ctx && ctx.confirmed ? (ctx.email || 'Не удалось получить почту аккаунта') + ' | ' + (ctx.premiumDays === null ? 'срок неизвестен' : ctx.premiumDays + ' дн.') : '').toggleClass('hide', !ctx || !ctx.confirmed);
			settingsBody.find('[data-name="' + REZKA_SOURCE + '_do_login"] .settings-param__name').text(cookies ? 'Войти в HDRezka и сохранить куки' : 'Войти в HDRezka');
			settingsBody.find('[data-name="' + REZKA_SOURCE + '_cookie"] .settings-param__value').text(ctx && ctx.cookie ? 'Куки сохранены' : 'Не заданы');
			settingsBody.find('[data-name="' + REZKA_SOURCE + '_cookie"] .settings-param__descr').text(cookies ? 'Вставьте строку вида dle_user_id=...; dle_password=...; имя=значение. Вход проверится и сохранится автоматически.' : 'В Tizen и браузере импорт куки требует прокси. Вход по логину и паролю использует куки, которые сайт сохраняет сам.');
		}
		function notice(message, success) {
			if (activeStatus) {
				activeStatus.removeClass('active error wait').addClass(success ? 'active' : 'error');
				clearTimeout(statusTimer);
				statusTimer = setTimeout(function () {
					activeStatus.removeClass('active error');
					activeStatus = null;
				}, 5000);
			}
			refresh();
			var text = document.createElement('span');
			text.textContent = String(message || '');
			Lampa.Noty.show(text.innerHTML);
		}
		function stop() {
			revision++;
			network.clear();
			clearTimeout(statusTimer);
			if (activeStatus) activeStatus.removeClass('active error wait');
			activeStatus = null;
		}
		function begin(item) {
			stop();
			activeStatus = $(item).find('.settings-param__status').removeClass('active error').addClass('wait');
		}
		function current(ctx, token) {
			try { return token === revision && rezkaContext() === ctx; } catch (e) { return false; }
		}
		function context() {
			try { return rezkaContext(); } catch (e) { notice(e.message); return null; }
		}

		Lampa.Params.select(REZKA_SOURCE + '_mirror', '', '');
		Lampa.Params.select(REZKA_SOURCE + '_proxy', '', '');
		Lampa.Params.select(REZKA_SOURCE + '_login_name', '', '');
		Lampa.Storage.set(REZKA_SOURCE + '_login_password', '');
		Lampa.Params.select(REZKA_SOURCE + '_mp4', {'false': 'HLS (m3u8)', 'true': 'MP4'}, false);

		Lampa.Storage.listener.follow('change', function (e) {
			if (e.name === REZKA_SOURCE + '_mirror' || e.name === REZKA_SOURCE + '_proxy') {
				stop();
				Lampa.Storage.set(REZKA_SOURCE + '_session', {});
				rezkaSession = null;
				refresh();
			}
			if (e.name === REZKA_SOURCE + '_login_name') stop();
		});

		var tmpl = '<div><div class="settings-param"><div class="settings-param__name">Аккаунт HDRezka</div><div class="settings-param__value rezka-account-state"></div><div class="settings-param__descr rezka-account-email hide"></div></div>';
		tmpl += '<div class="settings-param selector" data-name="' + REZKA_SOURCE + '_mirror" data-type="input" placeholder="https://kvk.zone">';
		tmpl += '<div class="settings-param__name">Зеркало HDRezka</div>';
		tmpl += '<div class="settings-param__value"></div>';
		tmpl += '<div class="settings-param__descr">Укажите доступное вам зеркало. По умолчанию: https://kvk.zone.</div>';
		tmpl += '</div>';
		tmpl += '<div class="settings-param selector" data-name="' + REZKA_SOURCE + '_login_name" data-type="input" data-string="true" placeholder="#{settings_cub_not_specified}">';
		tmpl += '<div class="settings-param__name">Логин или почта</div>';
		tmpl += '<div class="settings-param__value"></div>';
		tmpl += '</div>';
		tmpl += '<div class="settings-param selector" data-name="' + REZKA_SOURCE + '_do_login" data-static="true">';
		tmpl += '<div class="settings-param__name">Войти в HDRezka</div>';
		tmpl += '<div class="settings-param__status"></div>';
		tmpl += '<div class="settings-param__descr">Введите логин выше, затем нажмите здесь и укажите пароль. Вход сохраняется для выбранного зеркала.</div>';
		tmpl += '</div>';
		tmpl += '<div class="settings-param selector" data-name="' + REZKA_SOURCE + '_cookie" data-static="true">';
		tmpl += '<div class="settings-param__name">Войти по куки</div>';
		tmpl += '<div class="settings-param__value"></div>';
		tmpl += '<div class="settings-param__status"></div>';
		tmpl += '<div class="settings-param__descr"></div>';
		tmpl += '</div>';
		tmpl += '<div class="settings-param selector" data-name="' + REZKA_SOURCE + '_check" data-static="true">';
		tmpl += '<div class="settings-param__name">Проверить вход</div>';
		tmpl += '<div class="settings-param__status"></div>';
		tmpl += '<div class="settings-param__descr">Проверить, действует ли сохранённый вход.</div>';
		tmpl += '</div>';
		tmpl += '<div class="settings-param selector" data-name="' + REZKA_SOURCE + '_logout" data-static="true">';
		tmpl += '<div class="settings-param__name">Выйти из HDRezka</div>';
		tmpl += '<div class="settings-param__status"></div>';
		tmpl += '</div>';
		tmpl += '<div class="settings-param selector" data-name="' + REZKA_SOURCE + '_mp4" data-type="select">';
		tmpl += '<div class="settings-param__name">Формат потока</div>';
		tmpl += '<div class="settings-param__value"></div>';
		tmpl += '</div>';
		tmpl += '<div class="settings-param-title"><span>Дополнительно</span></div>';
		tmpl += '<div class="settings-param selector" data-name="' + REZKA_SOURCE + '_proxy" data-type="input" placeholder="Без прокси">';
		tmpl += '<div class="settings-param__name">Прокси для HDRezka</div>';
		tmpl += '<div class="settings-param__value" style="white-space: normal; word-break: break-all;"></div>';
		tmpl += '<div class="settings-param__descr">Укажите адрес HTTPS-прокси с поддержкой enc2 и cookie_plus. Через сервер передаются логин, пароль и куки HDRezka. Оставьте поле пустым для подключения без прокси.</div>';
		tmpl += '</div>';
		tmpl += '</div>';
		Lampa.Template.add('settings_lamponline_rezka', tmpl);

		var parentTmpl = '<div>' +
			'<div class="settings-folder selector" data-component="lamponline_rezka" data-static="true">' +
			'<div class="settings-folder__icon">' +
			'<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="3" y="4" width="26" height="24" rx="3" stroke="currentColor" stroke-width="2"/><path d="M8 4v24M24 4v24M3 10h5M3 16h5M3 22h5M24 10h5M24 16h5M24 22h5" stroke="currentColor" stroke-width="2"/><path d="m13 11 8 5-8 5V11Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/></svg>' +
			'</div>' +
			'<div class="settings-folder__name">HDRezka</div>' +
			'</div>' +
			'</div>';
		Lampa.Template.add('settings_lamponline_settings', parentTmpl);

		Lampa.Settings.listener.follow('open', function (e) {
			if (e.name == 'lamponline_settings') {
				e.body.find('[data-component="lamponline_rezka"]').on('hover:enter', function () {
					Lampa.Settings.create('lamponline_rezka', {
						onBack: function () { Lampa.Settings.create('lamponline_settings'); }
					});
				});
			}
		});

		Lampa.Settings.listener.follow('open', function (e) {
			stop();
			settingsBody = null;
			if (e.name !== 'lamponline_rezka') return;
			settingsBody = e.body;
			refresh();
			var ctx = context(), token = revision;
			if (ctx) rezkaVerify(network, ctx, function () { return current(ctx, token); }, refresh, function (message) {
				refresh();
				var saved = Lampa.Storage.get(REZKA_SOURCE + '_session', {});
				if (ctx.confirmed || saved && saved.key === ctx.key) {
					settingsBody.find('.rezka-account-state').text('Не удалось проверить вход. ' + message);
				}
			});

			e.body.find('[data-name="' + REZKA_SOURCE + '_do_login"]').unbind('hover:enter').on('hover:enter', function () {
				begin(this);
				var ctx = context(), token = revision;
				if (!ctx) return;
				var name = Lampa.Storage.value(REZKA_SOURCE + '_login_name', '').trim();
				if (!name) { notice('Укажите логин или почту Rezka в поле выше.'); return; }
				Lampa.Input.edit({title: 'Пароль HDRezka', value: '', nosave: true, free: true, nomic: true, type: 'password'}, function (password) {
					if (!current(ctx, token) || !password) return;
					var candidate = $.extend({}, ctx);
					candidate.cookie = '';
					candidate.confirmed = false;
					candidate.userId = '';
					candidate.email = '';
					candidate.serial = ++rezkaSerial;
					var data = {login_name: name, login_password: password, login_not_save: 0};
					var alive = function () { return current(ctx, token); };
					rezkaRequest(network, candidate, ctx.host + '/ajax/login/', data, true, alive, function (json) {
						if (!(json.success === true || json.success === 1 || json.message === 'Уже авторизован на сайте. Необходимо обновить страницу!')) {
							notice(rezkaMessage(json.message || json.error || 'Rezka отклонила вход. Проверьте логин и пароль.'));
							return;
						}
						rezkaVerify(network, candidate, alive, function () {
							rezkaSession = candidate;
							rezkaRemember(candidate);
							notice('Вы вошли в HDRezka.' + (candidate.android || candidate.proxy ? ' Куки сохранены автоматически.' : ''), true);
						}, notice);
					}, notice);
					password = '';
					data.login_password = '';
				});
			});

			e.body.find('[data-name="' + REZKA_SOURCE + '_check"]').unbind('hover:enter').on('hover:enter', function () {
				begin(this);
				var ctx = context(), token = revision;
				if (ctx) rezkaVerify(network, ctx, function () { return current(ctx, token); }, function () { notice('Вход в HDRezka действует.', true); }, notice);
			});

			e.body.find('[data-name="' + REZKA_SOURCE + '_cookie"]').unbind('hover:enter').on('hover:enter', function () {
				stop();
				var ctx = context(), token = revision;
				if (!ctx) return;
				if (!ctx.android && !ctx.proxy) { notice('Для входа по куки укажите прокси в настройках ниже или используйте Android Lampa 339+.'); return; }
				var item = this;
				Lampa.Input.edit({title: 'Куки HDRezka', value: ctx.cookie, placeholder: 'имя=значение; имя=значение', nosave: true, free: true, nomic: true}, function (value) {
					if (value == null || !current(ctx, token)) return;
					begin(item);
					token = revision;
					if (!value.trim()) {
						rezkaForget(ctx);
						notice('Куки HDRezka удалены.', true);
						return;
					}
					value = value.trim().replace(/^Cookie:\s*/i, '');
					var parts = value.split(';').map(function (part) {
						var pos = part.indexOf('=');
						return pos < 0 ? part.trim() : part.slice(0, pos).trim().replace(/\\_/g, '_') + '=' + part.slice(pos + 1).trim();
					}).filter(function (part) { return part; });
					if (/[\r\n]/.test(value) || !parts.length || !parts.every(function (part) { return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+=[\x21-\x3A\x3C-\x7E]*$/.test(part); })) {
						notice('Некорректная cookie: нужны пары имя=значение без переноса строк.'); return;
					}
					var candidate = $.extend({}, ctx);
					candidate.cookie = parts.join('; ');
					candidate.confirmed = false;
					candidate.userId = '';
					candidate.email = '';
					candidate.serial = ++rezkaSerial;
					rezkaVerify(network, candidate, function () { return current(ctx, token); }, function () {
						rezkaSession = candidate;
						rezkaRemember(candidate);
						notice('Куки сохранены. Вы вошли в HDRezka.', true);
					}, notice);
				});
			});

			e.body.find('[data-name="' + REZKA_SOURCE + '_logout"]').unbind('hover:enter').on('hover:enter', function () {
				begin(this);
				var ctx = context(), token = revision;
				if (!ctx) return;
				var oldCookie = ctx.cookie;
				rezkaForget(ctx);
				rezkaSession = null;
				var next = rezkaContext();
				refresh();
				ctx.cookie = oldCookie;
				rezkaRequest(network, ctx, ctx.host + '/logout/', false, false, function () { return current(next, token); }, function () {
					ctx.cookie = '';
					notice('Вы вышли из HDRezka.', true);
				}, function () {
					ctx.cookie = '';
					notice('Локальный вход удалён. Выход на сайте не подтверждён; при необходимости выйдите через браузер.');
				});
			});
		});
	}

	function rezkaPlaylist(value) {
		value = String(value || '').trim();
		if (value.charAt(0) === '#') {
			value = value.slice(2);
			['$$!!@$$@^!@#$$@', '@@@@@!##!^^^', '####^!!##!@@', '^^^!@##!!##', '$$#!!@#!@##'].forEach(function (trash) {
				value = value.split('//_//' + btoa(trash)).join('');
			});
			try {
				value = decodeURIComponent(atob(value).split('').map(function (c) {
					return '%' + ('0' + c.charCodeAt(0).toString(16)).slice(-2);
				}).join(''));
			} catch (e) { throw new Error('Не удалось декодировать поток Rezka. Возможно, сайт изменил формат.'); }
		}
		var result = [];
		if (value.charAt(0) !== '[') return result;
		value.slice(1).split(/,\s*\[/).forEach(function (part) {
			var end = part.indexOf(']');
			if (end < 0) return;
			var rawLabel = part.slice(0, end).trim();
			var label = rezkaMessage(rawLabel).replace(/\s+/g, ' ').trim();
			var restricted = /prem-quality|prem-icon/i.test(rawLabel);
			part.slice(end + 1).split(/;\s*\{/).forEach(function (variant) {
				variant = variant.replace(/^\{?[^}]*\}/, '').replace(/[,;]\s*$/, '');
				var links = variant.split(/\s+or\s+/).map(function (url) {
					url = url.trim();
					if (url.indexOf('//') === 0) url = 'https:' + url;
					return /^https?:\/\/[^\s]+$/i.test(url) ? url : '';
				}).filter(function (url) { return !!url; });
				if (label && links.length) result.push({label: label, links: links, restricted: restricted});
			});
		});
		return result;
	}

	function RezkaClient() {
		var network = new Lampa.Reguest(), generation = 0;
		var pages = Object.create(null), routes = Object.create(null), routeSerial = 0;
		var prefix = REZKA_SOURCE + ':' + (++rezkaSerial) + ':';
		this.clear = function () { generation++; network.clear(); };

		function route(data) {
			var id = prefix + (++routeSerial);
			routes[id] = data;
			return id;
		}
		function operation(success, error) {
			var token = generation, ctx, done = false;
			try { ctx = rezkaContext(); } catch (e) { error(e.message); return null; }
			function alive() {
				try { return !done && token === generation && rezkaContext() === ctx; } catch (e) { return false; }
			}
			return {
				ctx: ctx, alive: alive,
				ok: function (value) { if (alive()) { done = true; success(value); } },
				fail: function (message) { if (alive()) { done = true; error(message || 'Rezka не вернула данные.'); } },
				request: function (url, data, json, call) { rezkaRequest(network, ctx, url, data, json, alive, call, this.fail); }
			};
		}
		function episodes(html) {
			var doc = rezkaDocument(html), data = {seasons: [], episodes: []};
			Array.prototype.forEach.call(doc.querySelectorAll('.b-simple_season__item'), function (node) {
				var id = node.getAttribute('data-tab_id');
				if (/^\d+$/.test(id)) data.seasons.push({id: id, title: rezkaText(node) || 'Сезон ' + id});
			});
			Array.prototype.forEach.call(doc.querySelectorAll('.b-simple_episode__item'), function (node) {
				var season = node.getAttribute('data-season_id'), episode = node.getAttribute('data-episode_id');
				if (/^\d+$/.test(season) && /^\d+$/.test(episode)) data.episodes.push({season: season, episode: episode, title: rezkaText(node) || 'Серия ' + episode});
			});
			data.seasons.sort(function (a, b) { return Number(a.id) - Number(b.id); });
			data.episodes.sort(function (a, b) { return Number(a.season) - Number(b.season) || Number(a.episode) - Number(b.episode); });
			return data;
		}
		function page(html, url, ctx) {
			var doc = rezkaDocument(html), scripts = '';
			Array.prototype.forEach.call(doc.querySelectorAll('script'), function (node) { scripts += '\n' + node.textContent; });
			var series = scripts.match(/\.initCDNSeriesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/);
			var movie = scripts.match(/\.initCDNMoviesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/);
			var init = series || movie;
			if (!init) throw new Error('На странице нет поддерживаемого плеера Rezka. Проверьте зеркало и выбранный фильм.');
			var fallback = 'Оригинал';
			Array.prototype.forEach.call(doc.querySelectorAll('td'), function (node) {
				if (/^В переводе\s*:?$/.test(rezkaText(node)) && node.nextElementSibling) fallback = rezkaText(node.nextElementSibling) || fallback;
			});
			var item = {url: url, ctx: ctx, id: init[1], series: !!series, voices: [], episodes: Object.create(null),
				favs: (doc.querySelector('#ctrl_favs') || {}).value || ''};
			Array.prototype.forEach.call(doc.querySelectorAll('#translators-list .b-translator__item'), function (node) {
				var id = node.getAttribute('data-translator_id');
				if (!/^\d+$/.test(id)) return;
				var title = (node.getAttribute('title') || rezkaText(node)).trim();
				Array.prototype.forEach.call(node.querySelectorAll('img'), function (img) {
					var lang = img.getAttribute('title') || img.getAttribute('alt') || '';
					if (lang && title.indexOf(lang) === -1) title += ' (' + lang + ')';
				});
				item.voices.push({id: id, title: title || fallback, is_camrip: node.getAttribute('data-camrip') || '0',
					is_ads: node.getAttribute('data-ads') || '0', is_director: node.getAttribute('data-director') || '0'});
			});
			if (!item.voices.length) item.voices.push({id: init[2], title: fallback, is_camrip: movie ? movie[3] : '0',
				is_ads: movie ? movie[4] : '0', is_director: movie ? movie[5] : '0'});
			return item;
		}
		function index(items, id, name, fallback) {
			var found = -1;
			items.some(function (item, i) {
				if (id !== undefined && id !== '' && String(item.id) === String(id)) { found = i; return true; }
				return false;
			});
			if (found < 0 && name) items.some(function (item, i) {
				if (item.title === name) { found = i; return true; }
				return false;
			});
			return found >= 0 ? found : (items[Number(fallback)] ? Number(fallback) : 0);
		}
		function result(choice) { return {videos: [], seasons: [], voices: [], choice: choice, similars: []}; }
		function show(op, item, choice, selected) {
			var vi = index(item.voices, selected && selected.type === 'voice' ? selected.id : choice.voice_id, choice.voice_name, choice.voice);
			var voice = item.voices[vi];
			choice.voice = vi;
			choice.voice_id = voice.id;
			choice.voice_name = voice.title;
			function draw(data) {
				var si = index(data.seasons, selected && selected.type === 'season' ? selected.id : choice.season_id, '', choice.season);
				var season = data.seasons[si];
				choice.season = si;
				choice.season_id = season ? season.id : '';
				var output = result(choice);
				output.voices = item.voices.map(function (v) { return {title: v.title, url: route({page: item.url, type: 'voice', id: v.id, ctx: op.ctx})}; });
				choice.voice_url = output.voices[vi].url;
				output.seasons = data.seasons.map(function (s) { return {title: s.title, url: route({page: item.url, type: 'season', id: s.id, ctx: op.ctx})}; });
				var list = item.series ? data.episodes.filter(function (ep) { return season && ep.season === season.id; }) : [{season: 0, episode: 0, title: voice.title}];
				output.videos = list.map(function (ep) {
					var stream = {id: item.id, translator_id: voice.id, favs: item.favs, series: item.series,
						season: Number(ep.season), episode: Number(ep.episode), is_camrip: voice.is_camrip,
						is_ads: voice.is_ads, is_director: voice.is_director, binding: op.ctx.key, session: op.ctx.serial};
					return {method: 'call', url: prefix + 'video:' + item.id + ':' + voice.id + ':' + ep.season + ':' + ep.episode,
						rezka: stream, text: ep.title, voice_name: voice.title, season: Number(ep.season), episode: Number(ep.episode)};
				});
				if (!output.videos.length) op.fail('Для выбранного сезона и перевода нет серий.');
				else op.ok(output);
			}
			if (!item.series) { draw({seasons: [], episodes: []}); return; }
			if (item.episodes[voice.id]) { draw(item.episodes[voice.id]); return; }
			op.request(op.ctx.host + '/ajax/get_cdn_series/?t=' + Date.now(), {id: item.id, translator_id: voice.id, favs: item.favs, action: 'get_episodes'}, true, function (json) {
				if (json.success === false || !json.seasons || !json.episodes) {
					op.fail(rezkaMessage(json.message || json.error || 'Rezka не вернула сезоны и серии для этой озвучки.')); return;
				}
				var data = episodes(json.seasons + '\n' + json.episodes);
				item.episodes[voice.id] = data;
				draw(data);
			});
		}
		function open(op, url, choice, selected) {
			try { url = rezkaPageUrl(url, op.ctx); } catch (e) { op.fail(e.message); return; }
			var cached = pages[url];
			if (cached && cached.ctx === op.ctx) { show(op, cached, choice, selected); return; }
			op.request(url, false, false, function (html) {
				var item;
				try { item = page(html, url, op.ctx); } catch (e) { op.fail(e.message); return; }
				pages[url] = item;
				show(op, item, choice, selected);
			});
		}
		function titleKey(value) { return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[\s.,:;!?'"«»„“”‘’()\[\]{}\-–—_\/\\]+/g, ''); }
		function searchItems(html, ctx) {
			var doc = rezkaDocument(html), items = [];
			Array.prototype.forEach.call(doc.querySelectorAll('li > a[href], .b-content__inline_item-link > a[href]'), function (link) {
				var enty = link.querySelector('.enty'), full = link.parentNode.className === 'b-content__inline_item-link';
				if (!enty && !full) return;
				var title = rezkaText(enty || link), copy = link.cloneNode(true);
				Array.prototype.forEach.call(copy.querySelectorAll('.enty, .rating'), function (node) { node.parentNode.removeChild(node); });
				var details = full ? rezkaText(link.parentNode.querySelector('div')) : rezkaText(copy);
				var year = details.match(/\b((?:19|20)\d{2})\b/);
				var original = details.match(/^\s*\((.*?),\s*(?:19|20)\d{2}/);
				var url;
				try { url = rezkaPageUrl(link.getAttribute('href'), ctx); } catch (e) { return; }
				items.push({text: title, url: url, year: year ? Number(year[1]) : 0, details: details, original: original ? original[1].trim() : ''});
			});
			return {items: items, more: !!doc.querySelector('.b-search__live_all, .b-navigation__next')};
		}
		function moreSearch(op, choice, query, number) {
			op.request(op.ctx.host + '/search/?do=search&subaction=search&q=' + encodeURIComponent(query) + '&page=' + number, false, false, function (html) {
				var found = searchItems(html, op.ctx), output = result(choice);
				output.similars = found.items;
				if (found.more) output.similars.push({text: 'Ещё результаты: ' + query, url: route({type: 'search', query: query, number: number + 1, ctx: op.ctx}), year: 0, details: 'Следующая страница поиска Rezka'});
				if (output.similars.length) op.ok(output); else op.fail('По этому запросу больше ничего не найдено.');
			});
		}
		function search(op, object, choice) {
			var movie = object.movie || object;
			var names = [object.search || movie.title || movie.name, movie.original_title || movie.original_name].filter(function (name, i, all) { return name && all.indexOf(name) === i; });
			var date = object.search_date || (!object.clarification && (movie.release_date || movie.first_air_date)) || '';
			var year = parseInt(String(date).slice(0, 4), 10) || 0, items = [], more = [], cursor = 0;
			if (!names.length) { op.fail('Для поиска Rezka необходимо название.'); return; }
			function next() {
				if (cursor < names.length) {
					var query = names[cursor++];
					op.request(op.ctx.host + '/engine/ajax/search.php', {q: query}, false, function (html) {
						var found = searchItems(html, op.ctx);
						found.items.forEach(function (item) { if (!items.some(function (other) { return other.url === item.url; })) items.push(item); });
						if (found.more || !found.items.length) more.push(query);
						next();
					});
					return;
				}
				var exact = items.filter(function (item) {
					return (!year || item.year === year) && names.some(function (name) { return titleKey(name) && (titleKey(name) === titleKey(item.text) || titleKey(name) === titleKey(item.original)); });
				});
				if (exact.length === 1 && !more.length) { open(op, exact[0].url, choice); return; }
				var output = result(choice);
				output.similars = items;
				more.forEach(function (query) { output.similars.push({text: 'Все результаты: ' + query, url: route({type: 'search', query: query, number: 1, ctx: op.ctx}), year: 0, details: 'Полный поиск Rezka'}); });
				if (output.similars.length) op.ok(output); else op.fail('Rezka: ничего не найдено по названию и оригинальному названию.');
			}
			next();
		}
		this.restore = function (callback) {
			var op = operation(callback, function () { callback(); });
			if (!op) return;
			var saved = Lampa.Storage.get(REZKA_SOURCE + '_session', {});
			if (op.ctx.confirmed || !saved || saved.key !== op.ctx.key) { op.ok(); return; }
			rezkaVerify(network, op.ctx, op.alive, op.ok, op.fail);
		};
		this.load = function (object, saved, url, success, error) {
			this.clear();
			var op = operation(success, error);
			if (!op) return;
			var choice = $.extend({}, saved), selected = url && routes[url];
			if (url && url.indexOf(REZKA_SOURCE + ':') === 0 && (!selected || selected.ctx !== op.ctx)) {
				op.fail('Локальный маршрут Rezka устарел. Откройте фильм заново.'); return;
			}
			rezkaVerify(network, op.ctx, op.alive, function () {
				if (selected && selected.type === 'search') moreSearch(op, choice, selected.query, selected.number);
				else if (url) open(op, selected ? selected.page : url, choice, selected);
				else search(op, object || {}, choice);
			}, op.fail);
		};
		this.getStream = function (file, success, error) {
			var op = operation(success, error);
			if (!op) return;
			var data = file && file.rezka;
			if (!data || data.binding !== op.ctx.key || data.session !== op.ctx.serial || !/^\d+$/.test(data.id) || !/^\d+$/.test(data.translator_id)) {
				op.fail('Данные потока Rezka устарели. Откройте фильм заново.'); return;
			}
			rezkaVerify(network, op.ctx, op.alive, function () {
				var post = {id: data.id, translator_id: data.translator_id, favs: data.favs || '', action: data.series ? 'get_stream' : 'get_movie'};
				if (data.series) { post.season = data.season; post.episode = data.episode; }
				else { post.is_camrip = data.is_camrip || '0'; post.is_ads = data.is_ads || '0'; post.is_director = data.is_director || '0'; }
				op.request(op.ctx.host + '/ajax/get_cdn_series/?t=' + Date.now(), post, true, function (json) {
					var output, problem;
					try {
						if (!json.url) throw new Error(rezkaMessage(json.message || json.error || (json.premium_content ? 'Перевод доступен только с HDrezka Premium' : 'Rezka не вернула ссылку на поток.')));
						var mp4 = Lampa.Storage.get(REZKA_SOURCE + '_mp4', false) === true;
						var playlist = rezkaPlaylist(json.url);
						var items = playlist.filter(function (item) { return !item.restricted; }).map(function (item) {
							var preferred = item.links.filter(function (url) { return (mp4 ? /\.mp4(?:[?#]|$)/i : /\.m3u8(?:[?#]|$)/i).test(url); });
							var rank = item.label.match(/(\d+)\s*k/i), numeric = item.label.match(/\d+/);
							return {label: item.label, url: (preferred.length ? preferred : item.links)[0], rank: rank ? Number(rank[1]) * 1000 : Number(numeric && numeric[0]) || 0};
						});
						items.sort(function (a, b) { return b.rank - a.rank || (a.label < b.label ? 1 : a.label > b.label ? -1 : 0); });
						if (!items.length) throw new Error(playlist.some(function (item) { return item.restricted; }) ? 'Все качества этого перевода доступны только с HDRezka Premium. Выберите другой перевод.' : 'В ответе Rezka нет поддерживаемых потоков.');
						var premium = !!json.premium_content, previous = '';
						output = {url: items[0].url, quality: {}, subtitles: []};
						items.forEach(function (item) {
							if (item.label !== '1080p Ultra') {
								if (previous && previous !== item.url) premium = false;
								previous = item.url;
							}
							var label = item.label === '4K' ? '2160p' : item.label === '2K' ? '1440p' : item.label === '1080p Ultra' ? '1080p' : item.label;
							if (!output.quality[label]) output.quality[label] = item.url;
						});
						if (premium) throw new Error('Перевод доступен только с HDrezka Premium');
						output.subtitles = rezkaPlaylist(json.subtitle).map(function (item) { return {label: item.label, url: item.links[0]}; });
					} catch (e) { problem = e.message; }
					if (problem) op.fail(problem); else op.ok(output);
				});
			}, op.fail);
		};
	}

	function component(object) {
		var sourceNetwork = new Lampa.Reguest();
		var lifeNetwork = new Lampa.Reguest();
		var streamNetwork = new Lampa.Reguest();
		var subtitleNetwork = new Lampa.Reguest();
		var externalIdsNetwork = new Lampa.Reguest();
		var pendingRequests = [];
		var cancelLife;

		function cancellationError() {
			var error = new Error("Запрос отменён");
			error.cancelled = true;
			return error;
		}

		function cancelRequests(network) {
			pendingRequests.slice().forEach(function (cancel) {
				if (cancel.network === network) cancel();
			});
			network.clear();
		}

		function clearNetworks() {
			pendingRequests.slice().forEach(function (cancel) { cancel(); });
			if (cancelLife) cancelLife();
			[sourceNetwork, lifeNetwork, streamNetwork, subtitleNetwork, externalIdsNetwork].forEach(function (request) { request.clear(); });
		}
		var rezka = new RezkaClient();
		var scroll = new Lampa.Scroll({ mask: true, over: true });
		var files = new Lampa.Explorer(object);
		var filter = new Lampa.Filter(object);
		var sources = {};
		var last;
		var source;
		var balanser;
		var initialized;
		var initial_server = getServerUrl();
		var initial_bwa_revision = bwaRevision;
		var awaiting_setup = false;
		var refresh_timer;
		var balanser_timer;
		var images = [];
		var number_of_requests = 0;
		var number_of_requests_timer;
		var life_wait_times = 0;
		var life_wait_timer;
		var select_close_timer;
		var destroyed = false;
		var generation = 0;
		var request_generation = 0;
		var refreshAfterSetup = function () {
			var active = Lampa.Activity.active();
			if (destroyed || !active || active.activity !== this.activity || $('body').hasClass('settings--open')) return false;
			var bwaChanged = isBwaServer(getServerUrl()) && initial_bwa_revision !== bwaRevision;
			if (initial_server === getServerUrl() && !bwaChanged && !(awaiting_setup && rezkaAuthorized())) return false;
			clearTimeout(refresh_timer);
			refresh_timer = setTimeout(function () {
				var current = Lampa.Activity.active();
				if (destroyed || !current || current.activity !== active.activity || $('body').hasClass('settings--open')) return;
				Lampa.Activity.replace({lampac_custom_select: initial_server !== getServerUrl() || bwaChanged ? "" : REZKA_SOURCE});
			}, 0);
			return true;
		}.bind(this);
		var filter_sources = [];
		var filter_translate = {
			season: Lampa.Lang.translate("torrent_serial_season"),
			voice: Lampa.Lang.translate("torrent_parser_voice"),
			source: Lampa.Lang.translate("settings_rest_source")
		};
		var filter_find = { season: [], voice: [] };

		function getHlsType() {
			var type = Lampa.Storage.get(Config.StorageKeys.OnlineHlsPrefix + balanser, "");
			return type === "native" || type === "hlsjs" || type === "auto" ? type : "";
		}

		var NetworkManager = (function () {
			function getRchType() {
				var hostkey = getHostKey();
				return (
					(hostkey && window.rch_nws && window.rch_nws[hostkey]
						? window.rch_nws[hostkey].type
						: window.rch && hostkey && window.rch[hostkey]
							? window.rch[hostkey].type
							: "") || ""
				);
			}

			function buildMovieUrl(url) {
				var query = [];
				var card_source = object.movie.source || "tmdb";
				query.push("id=" + encodeURIComponent(object.movie.id));
				if (object.movie.imdb_id)
					query.push("imdb_id=" + (object.movie.imdb_id || ""));
				if (object.movie.kinopoisk_id)
					query.push("kinopoisk_id=" + (object.movie.kinopoisk_id || ""));
				if (object.movie.tmdb_id)
					query.push("tmdb_id=" + (object.movie.tmdb_id || ""));
				query.push(
					"title=" +
						encodeURIComponent(
							object.clarification
								? object.search
								: object.movie.title || object.movie.name
						)
				);
				query.push(
					"original_title=" +
						encodeURIComponent(
							object.movie.original_title || object.movie.original_name
						)
				);
				query.push("serial=" + (object.movie.name ? 1 : 0));
				query.push(
					"original_language=" + (object.movie.original_language || "")
				);
				query.push(
					"year=" +
						(
							(object.movie.release_date ||
								object.movie.first_air_date ||
								"0000") + ""
						).slice(0, 4)
				);
				query.push("source=" + card_source);
				query.push("clarification=" + (object.clarification ? 1 : 0));
				query.push("similar=" + (object.similar ? true : false));
				query.push("rchtype=" + getRchType());

				return buildUrl(url, query);
			}

			function silentPromise(network, url, data, options) {
				cancelRequests(network);
				return new Promise(function (resolve, reject) {
					function finish(error, json) {
						var index = pendingRequests.indexOf(cancel);
						if (index < 0) return;
						pendingRequests.splice(index, 1);
						if (error) reject(error); else resolve(json);
					}
					function cancel() { finish(cancellationError()); }
					cancel.network = network;
					pendingRequests.push(cancel);
					serverRequest(network, "silent",
						url,
						function (json) {
							finish(null, json);
						},
						function (e) {
							finish(e || new Error("Ошибка запроса"));
						},
						data,
						options
					);
				});
			}

			return {
				getRchType: getRchType,
				buildMovieUrl: buildMovieUrl,
				silentPromise: silentPromise
			};
		})();

		var StateManager = (function () {
			var StorageKeys = Config.StorageKeys;

			function getChoice(for_balanser) {
				var data = storageCache(
					StorageKeys.OnlineChoicePrefix + (for_balanser || balanser),
					3000,
					{}
				);
				var save = data && data[object.movie.id];
				if (!save || typeof save !== "object" || Array.isArray(save)) save = {};
				if (!save.episodes_view || typeof save.episodes_view !== "object" || Array.isArray(save.episodes_view)) save.episodes_view = {};
				Lampa.Arrays.extend(save, {
					season: 0,
					voice: 0,
					voice_name: "",
					voice_id: 0,
					episodes_view: {},
					movie_view: ""
				});
				return save;
			}

			function saveChoice(choice, for_balanser) {
				var data = storageCache(
					StorageKeys.OnlineChoicePrefix + (for_balanser || balanser),
					3000,
					{}
				);
				data[object.movie.id] = choice;
				Lampa.Storage.set(
					StorageKeys.OnlineChoicePrefix + (for_balanser || balanser),
					data
				);
				updateBalanser(for_balanser || balanser);
			}

			function replaceChoice(choice, for_balanser) {
				var to = getChoice(for_balanser);
				Lampa.Arrays.extend(to, choice, true);
				saveChoice(to, for_balanser);
			}

			function updateBalanser(balanser_name) {
				var last_select_balanser = storageCache(
					StorageKeys.OnlineLastBalanser,
					3000,
					{}
				);
				last_select_balanser[object.movie.id] = balanser_name;
				Lampa.Storage.set(StorageKeys.OnlineLastBalanser, last_select_balanser);
			}

			function watched(set) {
				var file_id = Lampa.Utils.hash(
					object.movie.original_name || object.movie.original_title
				);
				var watched = storageCache(
					StorageKeys.OnlineWatchedLast,
					5000,
					{}
				);
				if (set) {
					watched[file_id] = storedObject(watched[file_id]);
					Lampa.Arrays.extend(watched[file_id], set, true);
					Lampa.Storage.set(StorageKeys.OnlineWatchedLast, watched);
					return true;
				} else {
					return watched[file_id];
				}
			}

			function getLastChoiceBalanser() {
				var last_select_balanser = storageCache(
					StorageKeys.OnlineLastBalanser,
					3000,
					{}
				);
				if (last_select_balanser[object.movie.id]) {
					return last_select_balanser[object.movie.id];
				} else {
					return Lampa.Storage.get(
						StorageKeys.OnlineBalanser,
						""
					);
				}
			}

			return {
				getChoice: getChoice,
				saveChoice: saveChoice,
				replaceChoice: replaceChoice,
				updateBalanser: updateBalanser,
				watched: watched,
				getLastChoiceBalanser: getLastChoiceBalanser
			};
		})();

		var PlayerAdapter = (function () {
			function playbackUrl(url) {
				if (isBwaServer(getServerUrl()) && balanser === "rezka" && location.protocol === "https:" && typeof url === "string")
					return url.replace(/(^| or )http:\/\//gi, "$1https://");
				return url;
			}

			function toPlayElement(file, stream, details) {
				stream = stream || file;
				details = details || {};
				var quality = details.quality || stream.qualitys || file.qualitys;
				var play = {
					lamponline_stream: true,
					isonline: true,
					title: file.title,
					url: playbackUrl(stream.url),
					headers: details.headers || stream.headers || file.headers,
					quality: quality && typeof quality === "object" ? $.extend({}, quality) : quality,
					timeline: file.timeline,
					subtitles: stream.subtitles || file.subtitles,
					subtitles_call: details.subtitles_call || stream.subtitles_call,
					segments: details.segments || file.segments,
					hls_manifest_timeout: details.hls_manifest_timeout || stream.hls_manifest_timeout,
					callback: file.mark,
					season: file.season,
					episode: file.episode,
					voice_name: file.voice_name
				};
				if (play.quality && typeof play.quality === "object") {
					Object.keys(play.quality).forEach(function (name) {
						var value = play.quality[name];
						play.quality[name] = value && typeof value === "object" && typeof value.url === "string"
							? $.extend({}, value, {url: playbackUrl(value.url)}) : playbackUrl(value);
					});
				}
				if (stream.vast && stream.vast.url) {
					play.vast_url = stream.vast.url;
					play.vast_msg = stream.vast.msg;
					play.vast_region = stream.vast.region;
					play.vast_platform = stream.vast.platform;
					play.vast_screen = stream.vast.screen;
				}
				var hls_type = getHlsType();
				if (hls_type === "auto") {
					play.lamponline_hls_auto = true;
					play.hls_type = Lampa.Storage.field("player_hls_method") === "hlsjs" ? "hlsjs" : "native";
				}
				else if (hls_type) play.hls_type = hls_type;
				return play;
			}

			function orUrlReserve(data) {
				if (
					data.url &&
					typeof data.url == "string" &&
					data.url.indexOf(" or ") !== -1
				) {
					var urls = data.url.split(" or ");
					data.url = urls[0];
					data.url_reserve = urls[1];
				}
			}

			function setDefaultQuality(data) {
				if (data.quality && typeof data.quality === "object") {
					Object.keys(data.quality).forEach(function (name) {
						if (data.quality[name] === null) delete data.quality[name];
					});
					var url = Lampa.Player.getUrlQuality(data.quality, false);
					if (url) {
						if (url !== data.url) delete data.url_reserve;
						data.url = url;
						orUrlReserve(data);
					}
					for (var q in data.quality) {
						if (!Object.prototype.hasOwnProperty.call(data.quality, q)) continue;
						var quality = data.quality[q];
						if (typeof quality === "string") data.quality[q] = quality.split(" or ")[0];
						else if (quality && typeof quality.url === "string" && quality.url.indexOf(" or ") !== -1)
							data.quality[q] = $.extend({}, quality, {url: quality.url.split(" or ")[0]});
					}
				}
			}

			function loadSubtitles(link, playing) {
				playing = playing || Lampa.Player.playdata();
				if (destroyed || !playing) return;
				var token = generation;
				subtitleNetwork.clear();
				serverRequest(subtitleNetwork, "silent",
					account(link),
					function (subs) {
						if (destroyed || token !== generation || !Array.isArray(subs)) return;
						playing.subtitles = subs;
						if (playing === Lampa.Player.playdata() && Lampa.Player.opened() && Lampa.PlayerVideo.video())
							Lampa.Player.subtitles(subs);
					},
					function (e) {
						console.error(e);
					}
				);
			}

			return {
				toPlayElement: toPlayElement,
				orUrlReserve: orUrlReserve,
				setDefaultQuality: setDefaultQuality,
				loadSubtitles: loadSubtitles
			};
		})();

		function initTemplates() {
			if (lamponline_css_inited) return;

			Lampa.Template.add(
				"lampac_prestige_full",
				'<div class="online-prestige online-prestige--full selector">\n            <div class="online-prestige__img">\n                <img alt="">\n                <div class="online-prestige__loader"></div>\n            </div>\n            <div class="online-prestige__body">\n                <div class="online-prestige__head">\n                    <div class="online-prestige__title">{title}</div>\n                    <div class="online-prestige__time">{time}</div>\n                </div>\n\n                <div class="online-prestige__timeline"></div>\n\n                <div class="online-prestige__footer">\n                    <div class="online-prestige__info">{info}</div>\n                    <div class="online-prestige__quality">{quality}</div>\n                </div>\n            </div>\n        </div>'
			);
			Lampa.Template.add(
				"lampac_content_loading",
				'<div class="online-empty">\n            <div class="broadcast__scan"><div></div></div>\n\t\t\t\n            <div class="online-empty__templates">\n                <div class="online-empty-template selector">\n                    <div class="online-empty-template__ico"></div>\n                    <div class="online-empty-template__body"></div>\n                </div>\n                <div class="online-empty-template">\n                    <div class="online-empty-template__ico"></div>\n                    <div class="online-empty-template__body"></div>\n                </div>\n                <div class="online-empty-template">\n                    <div class="online-empty-template__ico"></div>\n                    <div class="online-empty-template__body"></div>\n                </div>\n            </div>\n        </div>'
			);
			Lampa.Template.add(
				"lampac_does_not_answer",
				'<div class="online-empty">\n            <div class="online-empty__title">\n                #{lampac_balanser_dont_work}\n            </div>\n            <div class="online-empty__time">\n                #{lampac_balanser_timeout}\n            </div>\n            <div class="online-empty__buttons">\n                <div class="online-empty__button selector cancel">#{cancel}</div>\n                <div class="online-empty__button selector change">#{lampac_change_balanser}</div>\n            </div>\n            <div class="online-empty__templates">\n                <div class="online-empty-template">\n                    <div class="online-empty-template__ico"></div>\n                    <div class="online-empty-template__body"></div>\n                </div>\n                <div class="online-empty-template">\n                    <div class="online-empty-template__ico"></div>\n                    <div class="online-empty-template__body"></div>\n                </div>\n                <div class="online-empty-template">\n                    <div class="online-empty-template__ico"></div>\n                    <div class="online-empty-template__body"></div>\n                </div>\n            </div>\n        </div>'
			);
			Lampa.Template.add(
				"lampac_server_not_configured",
				'<div class="online-empty">\n            <div class="online-empty__title">\n                #{lampac_server_not_set}\n            </div>\n            <div class="online-empty__time">\n                #{lampac_server_not_set_desc}\n            </div>\n            <div class="online-empty__buttons">\n                <div class="online-empty__button selector cancel">#{cancel}</div>\n                <div class="online-empty__button selector enter_server">#{lampac_enter_server}</div>\n            </div>\n            <div class="online-empty__templates">\n                <div class="online-empty-template">\n                    <div class="online-empty-template__ico"></div>\n                    <div class="online-empty-template__body"></div>\n                </div>\n                <div class="online-empty-template">\n                    <div class="online-empty-template__ico"></div>\n                    <div class="online-empty-template__body"></div>\n                </div>\n                <div class="online-empty-template">\n                    <div class="online-empty-template__ico"></div>\n                    <div class="online-empty-template__body"></div>\n                </div>\n            </div>\n        </div>'
			);
			Lampa.Template.add(
				"lampac_prestige_rate",
				'<div class="online-prestige-rate">\n            <svg width="17" height="16" viewBox="0 0 17 16" fill="none" xmlns="http://www.w3.org/2000/svg">\n                <path d="M8.39409 0.192139L10.99 5.30994L16.7882 6.20387L12.5475 10.4277L13.5819 15.9311L8.39409 13.2425L3.20626 15.9311L4.24065 10.4277L0 6.20387L5.79819 5.30994L8.39409 0.192139Z" fill="#fff"></path>\n            </svg>\n            <span>{rate}</span>\n        </div>'
			);
			Lampa.Template.add(
				"lampac_prestige_folder",
				'<div class="online-prestige online-prestige--folder selector">\n            <div class="online-prestige__folder">\n                <svg viewBox="0 0 128 112" fill="none" xmlns="http://www.w3.org/2000/svg">\n                    <rect y="20" width="128" height="92" rx="13" fill="white"></rect>\n                    <path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"></path>\n                    <rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"></rect>\n                </svg>\n            </div>\n            <div class="online-prestige__body">\n                <div class="online-prestige__head">\n                    <div class="online-prestige__title">{title}</div>\n                    <div class="online-prestige__time">{time}</div>\n                </div>\n\n                <div class="online-prestige__footer">\n                    <div class="online-prestige__info">{info}</div>\n                </div>\n            </div>\n        </div>'
			);
			Lampa.Template.add(
				"lampac_prestige_watched",
				'<div class="online-prestige online-prestige-watched selector">\n            <div class="online-prestige-watched__icon">\n                <svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">\n                    <circle cx="10.5" cy="10.5" r="9" stroke="currentColor" stroke-width="3"/>\n                    <path d="M14.8477 10.5628L8.20312 14.399L8.20313 6.72656L14.8477 10.5628Z" fill="currentColor"/>\n                </svg>\n            </div>\n            <div class="online-prestige-watched__body">\n                \n            </div>\n        </div>'
			);

			Lampa.Template.add(
				"lampac_css",
				"\n        <style>\n        @charset 'UTF-8';.online-prestige{position:relative;-webkit-border-radius:.3em;border-radius:.3em;background-color:rgba(0,0,0,0.3);display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}.online-prestige__body{padding:1.2em;line-height:1.3;-webkit-box-flex:1;-webkit-flex-grow:1;-moz-box-flex:1;-ms-flex-positive:1;flex-grow:1;position:relative}@media screen and (max-width:480px){.online-prestige__body{padding:.8em 1.2em}}.online-prestige__img{position:relative;width:13em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;min-height:8.2em}.online-prestige__img>img{visibility:hidden;position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;-webkit-border-radius:.3em;border-radius:.3em;opacity:0;-webkit-transition:opacity .3s;-o-transition:opacity .3s;-moz-transition:opacity .3s;transition:opacity .3s}.online-prestige__img--loaded>img{opacity:1;visibility:visible}@media screen and (max-width:480px){.online-prestige__img{width:7em;min-height:6em}}.online-prestige__folder{padding:1em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}.online-prestige__folder>svg{width:4.4em !important;height:4.4em !important}.online-prestige__viewed{position:absolute;top:1em;left:1em;background:rgba(0,0,0,0.45);-webkit-border-radius:100%;border-radius:100%;padding:.25em;font-size:.76em}.online-prestige__viewed>svg{width:1.5em !important;height:1.5em !important}.online-prestige__episode-number{position:absolute;top:0;left:0;right:0;bottom:0;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-box-pack:center;-webkit-justify-content:center;-moz-box-pack:center;-ms-flex-pack:center;justify-content:center;font-size:2em}.online-prestige__loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin-left:-1em;margin-top:-1em;background:url(./img/loader.svg) no-repeat center center;-webkit-background-size:contain;-o-background-size:contain;background-size:contain}.online-prestige__head,.online-prestige__footer{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-pack:justify;-webkit-justify-content:space-between;-moz-box-pack:justify;-ms-flex-pack:justify;justify-content:space-between;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}.online-prestige__timeline{margin:.8em 0}.online-prestige__timeline>.time-line{display:block !important}.online-prestige__title{font-size:1.7em;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}@media screen and (max-width:480px){.online-prestige__title{font-size:1.4em}}.online-prestige__time{padding-left:2em}.online-prestige__info{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}.online-prestige__info>*{overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}.online-prestige__quality{padding-left:1em;white-space:nowrap}.online-prestige__scan-file{position:absolute;bottom:0;left:0;right:0}.online-prestige__scan-file .broadcast__scan{margin:0}.online-prestige .online-prestige-split{font-size:.8em;margin:0 1em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}.online-prestige.focus::after{content:'';position:absolute;top:-0.6em;left:-0.6em;right:-0.6em;bottom:-0.6em;-webkit-border-radius:.7em;border-radius:.7em;border:solid .3em #fff;z-index:-1;pointer-events:none}.online-prestige+.online-prestige{margin-top:1.5em}.online-prestige--folder .online-prestige__footer{margin-top:.8em}.online-prestige-watched{padding:1em}.online-prestige-watched__icon>svg{width:1.5em;height:1.5em}.online-prestige-watched__body{padding-left:1em;padding-top:.1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-flex-wrap:wrap;-ms-flex-wrap:wrap;flex-wrap:wrap}.online-prestige-watched__body>span+span::before{content:' ● ';vertical-align:top;display:inline-block;margin:0 .5em}.online-prestige-rate{display:-webkit-inline-box;display:-webkit-inline-flex;display:-moz-inline-box;display:-ms-inline-flexbox;display:inline-flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}.online-prestige-rate>svg{width:1.3em !important;height:1.3em !important}.online-prestige-rate>span{font-weight:600;font-size:1.1em;padding-left:.7em}.online-empty{line-height:1.4}.online-empty__title{font-size:1.8em;margin-bottom:.3em}.online-empty__time{font-size:1.2em;font-weight:300;margin-bottom:1.6em}.online-empty__buttons{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}.online-empty__buttons>*+*{margin-left:1em}.online-empty__button{background:rgba(0,0,0,0.3);font-size:1.2em;padding:.5em 1.2em;-webkit-border-radius:.2em;border-radius:.2em;margin-bottom:2.4em}.online-empty__button.focus{background:#fff;color:black}.online-empty__templates .online-empty-template:nth-child(2){opacity:.5}.online-empty__templates .online-empty-template:nth-child(3){opacity:.2}.online-empty-template{background-color:rgba(255,255,255,0.3);padding:1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-border-radius:.3em;border-radius:.3em}.online-empty-template>*{background:rgba(0,0,0,0.3);-webkit-border-radius:.3em;border-radius:.3em}.online-empty-template__ico{width:4em;height:4em;margin-right:2.4em}.online-empty-template__body{height:1.7em;width:70%}.online-empty-template+.online-empty-template{margin-top:1em}.lampac-balanser-loader{display:inline-block;width:1.2em;height:1.2em;margin-top:0;margin-left:0.5em;background:url(./img/loader.svg) no-repeat 50% 50%;background-size:contain}.lampac-similar-img{height:7em;width:7em;border-radius:0.3em;visibility:hidden;}.lampac-dim-opacity{opacity:0.5}\n.lampac-similar-img.loaded { visibility: visible; }\n        </style>\n    "
			);
			$("body").append(Lampa.Template.get("lampac_css", {}, true));
			lamponline_css_inited = true;
		}

		ensureBalansersWithSearch();

		function balanserName(j) {
			if (!j || typeof j.name !== "string") return "";
			var bals = typeof j.balanser === "string" ? j.balanser : "";
			var name = j.name.split(" ")[0];
			return (bals || name).toLowerCase();
		}

		function clarificationSearchAdd(value) {
			var all = getClarificationSearch();
			all[clarificationSearchKey(object.movie)] = value;
			Lampa.Storage.set(Config.StorageKeys.ClarificationSearch, all);
		}

		function clarificationSearchDelete() {
			var all = getClarificationSearch();
			delete all[clarificationSearchKey(object.movie)];
			Lampa.Storage.set(Config.StorageKeys.ClarificationSearch, all);
		}

		this.showServerNotConfigured = function () {
			var html = Lampa.Template.get("lampac_server_not_configured", {});
			html.find(".cancel").on("hover:enter", function () {
				Lampa.Activity.backward();
			});
			html.find(".enter_server").on("hover:enter", function () {
				openServerInput();
			});
			scroll.clear();
			scroll.append(html);
			this.loading(false);
		};

		this.showRezkaLogin = function () {
			awaiting_setup = true;
			var needsSetup = !isServerConfigured() && !rezkaAuthorized();
			var html = Lampa.Template.get("lampac_does_not_answer", {});
			html.find(".online-empty__title").text(Lampa.Lang.translate(needsSetup ? "lampac_setup_title" : "lampac_rezka_login_title"));
			html.find(".online-empty__time").text(Lampa.Lang.translate(needsSetup ? "lampac_setup_desc" : "lampac_rezka_login_desc"));
			html.find(".cancel").on("hover:enter", function () {
				Lampa.Activity.backward();
			});
			html.find(".change").text(Lampa.Lang.translate("lampac_open_settings")).on("hover:enter", function () {
				Lampa.Controller.toggle("settings");
				if (needsSetup) return Lampa.Settings.create("lamponline_settings");
				Lampa.Settings.create("lamponline_rezka", {
					onBack: function () {
						Lampa.Settings.create("lamponline_settings");
					}
				});
			});
			scroll.clear();
			scroll.append(html);
			this.loading(false);
		};

		this.initialize = function () {
			initTemplates();
			Lampa.Settings.listener.follow("close", refreshAfterSetup);

			var _this = this;

			this.loading(true);
			filter.onSearch = function (value) {
				clarificationSearchAdd(value);
				Lampa.Activity.replace({
					search: value,
					clarification: true,
					similar: true
				});
			};
			filter.onBack = function () {
				_this.start();
			};
			filter
				.render()
				.find(".selector")
				.on("hover:enter", function () {
					clearInterval(balanser_timer);
				});
			filter
				.render()
				.find(".filter--search")
				.appendTo(filter.render().find(".torrent-filter"));

			function onFilterReset() {
				clarificationSearchDelete();
				_this.replaceChoice({
					season: 0,
					voice: 0,
					voice_url: "",
					voice_name: "",
					voice_id: 0,
					season_id: ""
				});
				Lampa.Select.close();
				Lampa.Activity.replace({
					clarification: 0,
					similar: 0
				});
			}

			function onFilterSelectItem(a, b) {
				if (!b || (a.stype !== "season" && a.stype !== "voice")) return;
				var item = filter_find[a.stype][b.index];
				if (!item || typeof item.url !== "string" || !item.url) return;
				var url = item.url;
				var choice = _this.getChoice();
				if (a.stype == "voice") {
					choice.voice_name = filter_find.voice[b.index].title;
					choice.voice_url = url;
				}
				choice[a.stype] = b.index;
				_this.saveChoice(choice);
				_this.reset();
				_this.request(url);
				clearTimeout(select_close_timer);
				select_close_timer = setTimeout(function () {
					if (destroyed) return;
					Lampa.Select.close();
				}, 10);
			}

			function onSortSelect(a) {
				if (destroyed) return;
				Lampa.Activity.mixState();
				object.lampac_custom_select = a.source;
				_this.changeBalanser(a.source);
			}

			filter.onSelect = function (type, a, b) {
				if (destroyed || !a) return;
				if (type == "filter") {
					if (a.reset) onFilterReset();
					else if (a.stype === "server") {
						openServerMenu(function () {
							serverBtn.find("div").text(getCurrentServerDisplay());
							a.subtitle = safeUiText(getCurrentServerDisplay());
						}, function () {
							if (!destroyed) filter.show(Lampa.Lang.translate("title_filter"), "filter");
						});
					}
					else if (a.stype === "source") {
						Lampa.Select.show({
							title: Lampa.Lang.translate("lampac_balanser"),
							items: sourceItems(),
							onSelect: onSortSelect,
							onBack: function () {
								if (!destroyed) filter.show(Lampa.Lang.translate("title_filter"), "filter");
							}
						});
					}
					else if (a.stype === "hls" && b) {
						Lampa.Storage.set(Config.StorageKeys.OnlineHlsPrefix + balanser, b.value);
						a.subtitle = b.title;
						a.items.forEach(function (item) { item.selected = item.value === b.value; });
					}
					else onFilterSelectItem(a, b);
				} else if (type == "sort") {
					onSortSelect(a);
				}
			};
			if (filter.addButtonBack) filter.addButtonBack();
			filter
				.render()
				.find(".filter--sort span")
				.text(Lampa.Lang.translate("lampac_balanser"));

			var serverBtn = $(
				'<div class="simple-button simple-button--filter selector filter--server"><span>' +
					Lampa.Lang.translate("lampac_server_short") +
					"</span><div></div></div>"
			);

			serverBtn.find("div").text(getCurrentServerDisplay());
			serverBtn.on("hover:enter", function () {
				openServerMenu(function () {
					serverBtn.find("div").text(getCurrentServerDisplay());
				});
			});
			filter.render().find(".filter--sort").before(serverBtn);
			filter.render().on("hover:focus", ".selector", function (e) {
				last = e.target;
			});
			balanser = object.lampac_custom_select || this.getLastChoiceBalanser();
			if (isServerConfigured() && balanser === REZKA_SOURCE && object.lampac_custom_select !== REZKA_SOURCE)
				balanser = "";
			addRezkaSource();
			filter_sources = Lampa.Arrays.getKeys(sources);
			if (!isServerConfigured()) balanser = REZKA_SOURCE;
			this.filter({source: filter_sources}, this.getChoice());

			scroll.body().addClass("torrent-list");
			files.appendFiles(scroll.render());
			files.appendHead(filter.render());
			scroll.minus(files.render().find(".explorer__files-head"));
			scroll.body().append(Lampa.Template.get("lampac_content_loading"));
			Lampa.Controller.enable("content");
			this.loading(false);

			if (balanser === REZKA_SOURCE || !isServerConfigured()) {
				if (balanser !== REZKA_SOURCE) return this.showServerNotConfigured();
				return rezka.restore(function () {
					if (destroyed) return;
					_this.search();
					if (isServerConfigured()) {
						_this.createSource().then(function () {
							if (!destroyed) _this.filter({source: filter_sources}, _this.getChoice());
						})["catch"](function () {
							if (!destroyed) filter.render().find(".lampac-balanser-loader").remove();
						});
					}
				});
			}

			if (object.balanser) {
				files.render().find(".filter--search").remove();
				sources = {};
				sources[object.balanser] = { name: object.balanser };
				balanser = object.balanser;
				addRezkaSource();
				filter_sources = Lampa.Arrays.getKeys(sources);
				this.filter({source: filter_sources}, this.getChoice());

				var reqUrl = account(object.url.replace("rjson=", "nojson="));

				return serverRequest(sourceNetwork, "native",
					reqUrl,
					function (response) {
						if (destroyed) return;
						this.parse(response);
					}.bind(this),
					function (e) {
						if (destroyed) return;
						_this.noConnectToServer(e);
					},
					false,
					{
						dataType: "text"
					}
				);
			}
			this.externalids()
				.then(function () {
					if (destroyed) return;
					return new Promise(function (resolve) {
						rezka.restore(resolve);
					}).then(function () {
						if (!destroyed) return _this.createSource();
					});
				})
				.then(function (json) {
					if (destroyed) return;
					return ensureBalansersWithSearch().then(function (list) {
						if (destroyed) return;
						var allow_search = balanser === REZKA_SOURCE;
						for (var i = 0; i < list.length; i++) {
							var b = list[i];
							if (balanser.slice(0, b.length) == b) {
								allow_search = true;
								break;
							}
						}
						if (!allow_search) {
							filter.render().find(".filter--search").addClass("hide");
						}
						return json;
					});
				})
				.then(function () {
					if (destroyed) return;
					_this.search();
				})
				["catch"](function (e) {
					if (destroyed || (e && e.cancelled)) return;
					_this.noConnectToServer(e);
				});
		};

		this.rch = function (json, noreset, onError) {
			if (destroyed) return;
			var _this2 = this;
			var token = generation;
			var request_token = request_generation;
			rchRun(json, function () {
				if (destroyed || token !== generation || request_token !== request_generation) return;
				if (!noreset) _this2.find();
				else noreset();
			}, function (error) {
				if (destroyed || token !== generation || request_token !== request_generation) return;
				if (onError) onError(error);
				else _this2.noConnectToServer(error);
			});
		};

		this.externalids = function () {
			if (object.movie.imdb_id && object.movie.kinopoisk_id) {
				return Promise.resolve();
			}

			var query = [];
			query.push("id=" + encodeURIComponent(object.movie.id));
			query.push("serial=" + (object.movie.name ? 1 : 0));
			if (object.movie.imdb_id)
				query.push("imdb_id=" + (object.movie.imdb_id || ""));
			if (object.movie.kinopoisk_id)
				query.push("kinopoisk_id=" + (object.movie.kinopoisk_id || ""));
			var url = account(
				Config.Urls.getLocalhost() + "externalids?" + query.join("&")
			);

			externalIdsNetwork.timeout(10000);
			return NetworkManager.silentPromise(externalIdsNetwork, url)
				.then(function (json) {
					if (destroyed) return;
					for (var name in json) {
						object.movie[name] = json[name];
					}
				})
				["catch"](function (e) {
					if (destroyed) return;
					if (e && e.cancelled) throw e;
					console.error(e);
				});
		};

		this.updateBalanser = StateManager.updateBalanser;

		this.changeBalanser = function (balanser_name) {
			this.updateBalanser(balanser_name);
			Lampa.Storage.set(Config.StorageKeys.OnlineBalanser, balanser_name);
			var to = this.getChoice(balanser_name);
			var from = this.getChoice();
			if (from.voice_name && from.voice_name !== to.voice_name) {
				to.voice_name = from.voice_name;
				to.voice_id = 0;
				to.voice_url = "";
			}
			this.saveChoice(to, balanser_name);
			Lampa.Activity.replace();
		};

		this.requestParams = NetworkManager.buildMovieUrl;

		this.getLastChoiceBalanser = StateManager.getLastChoiceBalanser;

		function addRezkaSource() {
			var ordered = {};
			ordered[REZKA_SOURCE] = {name: "HDRezka", show: true};
			Object.keys(sources).forEach(function (name) {
				if (name !== REZKA_SOURCE) ordered[name] = sources[name];
			});
			sources = ordered;
		}

		function sourceItems() {
			var items = filter_sources.map(function (name) {
				return {
					title: safeUiText(sources[name].name),
					source: name,
					selected: name == balanser,
					ghost: !sources[name].show
				};
			});
			if (filter_sources[0] === REZKA_SOURCE && items.length > 1)
				items.splice(1, 0, {title: "Балансеры сервера", separator: true});
			return items;
		}

		function selectedSourceTitle() {
			var selected = sources[balanser];
			return selected && typeof selected.name === "string" && selected.name.trim()
				? safeUiText(selected.name) : "...";
		}

		function updateSourceItems() {
			filter.set("sort", sourceItems());
			filter.chosen("sort", [selectedSourceTitle()]);
			filter.get("filter").forEach(function (item) {
				if (item.stype === "source") {
					item.hide = !filter_sources.length;
					item.subtitle = selectedSourceTitle();
				}
			});
		}

		this.startSource = function (json) {
			if (!Array.isArray(json)) return Promise.reject(new Error("Неверный список балансеров"));
			json.forEach(function (j) {
				var name = balanserName(j);
				if (!name) return;
				sources[name] = {
					url: j.url,
					name: j.name,
					show: typeof j.show == "undefined" ? true : j.show
				};
			});

			addRezkaSource();
			filter_sources = Lampa.Arrays.getKeys(sources);
			if (!filter_sources.length) return Promise.reject();

			var fallback = filter_sources.filter(function (name) {
				return sources[name].show && name !== REZKA_SOURCE;
			})[0];
			if (!fallback && balanser !== REZKA_SOURCE) return Promise.reject(new Error("Сервер не вернул доступных балансеров"));
			if (!sources[balanser]) balanser = fallback;
			if (!sources[balanser].show && !object.lampac_custom_select)
				balanser = fallback;
			source = sources[balanser].url;
			Lampa.Storage.set(Config.StorageKeys.ActiveBalanser, balanser);
			updateSourceItems();

			return Promise.resolve(json);
		};

		this.lifeSource = function () {
			var _this3 = this;
			var token = generation;
			return new Promise(function (resolve, reject) {
				var resolved = false;
				var stopped = false;
				cancelLife = function () { stopped = true; reject(cancellationError()); };

				function buildLifeUrl() {
					return NetworkManager.buildMovieUrl(
						Config.Urls.getLocalhost() + "lifeevents?memkey=" + encodeURIComponent(_this3.memkey || "")
					);
				}

				function delayNext() {
					life_wait_timer = setTimeout(function () {
						if (destroyed || token !== generation) return;
						if (!stopped) poll();
					}, 1000);
				}

				function tryResolve(json, any) {
					if (json && json.accsdb) {
						stopped = true;
						reject(json);
						return;
					}

					if (resolved) return;

					var last_balanser = balanser;
					var found = json.online.filter(function (c) {
						return (typeof c.show === "undefined" || c.show) &&
							(any || balanserName(c) === last_balanser);
					});

					if (found.length || any || last_balanser === REZKA_SOURCE) {
						resolved = true;
						resolve(
							json.online.filter(function (c) {
								return typeof c.show === "undefined" || c.show;
							})
						);
					}
				}

				function poll() {
					var url = buildLifeUrl();
					lifeNetwork.timeout(3000);
					NetworkManager.silentPromise(lifeNetwork, url)
						.then(function (json) {
							if (destroyed || token !== generation) return;
							if (json && json.accsdb) {
								stopped = true;
								reject(json);
								return;
							}
							if (!json || !Array.isArray(json.online)) throw new Error("Неверный список балансеров");
							json.online = json.online.filter(function (j) { return !!balanserName(j); });
							life_wait_times++;
							filter_sources = [];
							sources = {};
							json.online.forEach(function (j) {
								var name = balanserName(j);
								sources[name] = {
									url: j.url,
									name: j.name,
									show: typeof j.show == "undefined" ? true : j.show
								};
							});
							addRezkaSource();
							filter_sources = Lampa.Arrays.getKeys(sources);
							updateSourceItems();

							tryResolve(json, false);

							var lastb = balanser;
							if (life_wait_times > 15 || json.ready) {
								stopped = true;
								filter.render().find(".lampac-balanser-loader").remove();
								tryResolve(json, true);
							} else if (!resolved && sources[lastb] && sources[lastb].show) {
								tryResolve(json, true);
								delayNext();
							} else {
								delayNext();
							}
						})
						["catch"](function (e) {
							if (destroyed || token !== generation) return;
							life_wait_times++;
							if (life_wait_times > 15) {
								stopped = true;
								reject(e);
							} else {
								delayNext();
							}
						});
				}

				poll();
			});
		};

		this.createSource = function () {
			var _this4 = this;
			var token = generation;
			return Promise.resolve().then(function () {
				if (destroyed || token !== generation) throw cancellationError();
				return new Promise(function (resolve) {
					var rch = ensureRchNws();
					if (rch) rch.typeInvoke(getServerUrl(), resolve); else resolve();
				});
			}).then(function () {
				if (destroyed || token !== generation) throw cancellationError();
				var url = _this4.requestParams(Config.Urls.getLocalhost() + "lite/events?life=true");
				sourceNetwork.timeout(15000);
				return NetworkManager.silentPromise(sourceNetwork, url);
			}).then(function (json) {
				if (destroyed) return;
				if (json.accsdb) return Promise.reject(json);

				if (json.life) {
					_this4.memkey = json.memkey;
					if (json.title) {
						if (object.movie.name) object.movie.name = json.title;
						if (object.movie.title) object.movie.title = json.title;
					}
					filter
						.render()
						.find(".filter--sort")
						.append('<span class="lampac-balanser-loader"></span>');
					return _this4.lifeSource().then(function (online) {
						if (destroyed) return;
						return _this4.startSource(online);
					});
				}

				return _this4.startSource(json);
			});
		};

		this.create = function () {
			return this.render();
		};

		this.search = function () {
			this.filter(
				{
					source: filter_sources
				},
				this.getChoice()
			);
			this.find();
		};

		this.find = function () {
			if (balanser === REZKA_SOURCE) this.requestRezka();
			else this.request(this.requestParams(source));
		};

		this.requestRezka = function (url) {
			if (destroyed) return;
			if (!rezkaAuthorized()) return this.showRezkaLogin();
			request_generation++;
			var self = this;
			rezka.load(object, this.getChoice(), url, function (result) {
				if (destroyed) return;
				filter_find.season = result.seasons;
				filter_find.voice = result.voices;
				self.replaceChoice(result.choice);
				self.activity.loader(false);
				if (result.similars.length) self.similars(result.similars);
				else self.display(result.videos);
			}, function (message) {
				if (destroyed) return;
				if (!rezkaAuthorized()) return self.showRezkaLogin();
				addRezkaSource();
				filter_sources = Lampa.Arrays.getKeys(sources);
				self.filter({source: filter_sources}, self.getChoice());
				var html = Lampa.Template.get("lampac_does_not_answer", {});
				html.find(".online-empty__title").text("Rezka");
				html.find(".online-empty__time").text(message);
				html.find(".cancel").remove();
				html.find(".change").on("hover:enter", function () {
					filter.render().find(".filter--sort").trigger("hover:enter");
				});
				scroll.clear();
				scroll.append(html);
				self.loading(false);
			});
		};

		this.request = function (url) {
			if (destroyed) return;
			if (balanser === REZKA_SOURCE) return this.requestRezka(url);
			var token = generation;
			var request_token = ++request_generation;
			if (typeof url !== "string" || !url) return this.doesNotAnswer();
			number_of_requests++;
			var finalUrl = account(url);
			cancelRequests(sourceNetwork);

			if (number_of_requests < 10) {
				serverRequest(sourceNetwork, "native",
					finalUrl,
					function (response) {
						if (destroyed || token !== generation || request_token !== request_generation) return;
						this.parse(response);
					}.bind(this),
					function (e) {
						if (destroyed || token !== generation || request_token !== request_generation) return;
						this.doesNotAnswer(e);
					}.bind(this),
					false,
					{
						dataType: "text"
					}
				);
				clearTimeout(number_of_requests_timer);
				number_of_requests_timer = setTimeout(function () {
					if (destroyed) return;
					number_of_requests = 0;
				}, 4000);
			} else this.noConnectToServer();
		};

		this.parseJsonDate = function (str, name) {
			var elems = [];

			if (typeof str !== "string") {
				return [];
			}

			var root = null;
			try {
				if (!domParser && typeof DOMParser !== "undefined") {
					domParser = new DOMParser();
				}
				if (domParser) {
					var doc = domParser.parseFromString(
						"<div>" + str + "</div>",
						"text/html"
					);
					if (doc && doc.body) root = doc.body;
				}
			} catch (e) {}

			if (!root) {
				try {
					root = document.createElement("div");
					root.innerHTML = str;
				} catch (e) {
					return elems;
				}
			}

			var found = [];
			try {
				found = root.querySelectorAll ? root.querySelectorAll(name) : [];
			} catch (e) {
				found = [];
			}

			for (var i = 0; i < found.length; i++) {
				var item = found[i];
				try {
					var rawJson = item.getAttribute("data-json");
					if (!rawJson) {
						continue;
					}
					var data = JSON.parse(rawJson);
					if (!data || typeof data !== "object" || Array.isArray(data)) continue;
					var season = item.getAttribute("s");
					var episode = item.getAttribute("e");
					var text = item.textContent || item.innerText || "";
					if (!object.movie.name) {
						if (text.match(/\d+p/i)) {
							if (!data.quality) {
								data.quality = {};
								data.quality[text] = data.url;
							}
							text = object.movie.title;
						}
						if (text == "По умолчанию") {
							text = object.movie.title;
						}
					}
					if (episode) data.episode = parseInt(episode);
					if (season) data.season = parseInt(season);
					if (text) data.text = text;
					data.active = $(item).hasClass("active");
					elems.push(data);
				} catch (e) {
					console.error(e);
				}
			}

			return elems;
		};

		this.getFileUrl = function (file, call, waiting_rch) {
			if (destroyed) return;
			var _this = this;
			var token = generation;
			var cancelled = false;
			if (!file || typeof file !== "object") {
				call(false, {});
				return;
			}
			if (file.rezka) {
				Lampa.Loading.start(function () {
					cancelled = true;
					rezka.clear();
					Lampa.Loading.stop();
					Lampa.Controller.toggle("content");
				});
				return rezka.getStream(file, function (stream) {
					if (destroyed || cancelled || token !== generation) return;
					Lampa.Loading.stop();
					file.qualitys = stream.quality;
					call(stream, stream);
				}, function (message) {
					if (destroyed || cancelled || token !== generation) return;
					Lampa.Loading.stop();
					addRezkaSource();
					filter_sources = Lampa.Arrays.getKeys(sources);
					_this.filter({
						season: filter_find.season.map(function (s) { return s.title; }),
						voice: filter_find.voice.map(function (v) { return v.title; })
					}, _this.getChoice());
					Lampa.Noty.show($("<span>").text(message).html());
					call(false, {});
				});
			}
			if (
				Lampa.Storage.field("player") !== "inner" &&
				file.stream &&
				Lampa.Platform.is("apple")
			) {
				var newfile = Lampa.Arrays.clone(file);
				newfile.method = "play";
				newfile.url = file.stream;
				call(newfile, {});
			} else if (file.method == "play") call(file, {});
			else {
				if (typeof file.url !== "string" || !file.url) {
					call(false, {});
					return;
				}
				Lampa.Loading.start(function () {
					cancelled = true;
					Lampa.Loading.stop();
					Lampa.Controller.toggle("content");
					streamNetwork.clear();
				});
				cancelRequests(streamNetwork);
				serverRequest(streamNetwork, "native",
					account(file.url),
					function (json) {
						if (destroyed || cancelled || token !== generation) return;
						if (!json || typeof json !== "object" || Array.isArray(json)) {
							Lampa.Loading.stop();
							call(false, {});
							return;
						}
						if (json.rch) {
							if (waiting_rch) {
								Lampa.Loading.stop();
								call(false, {});
							} else {
								_this.rch(json, function () {
									if (destroyed || cancelled || token !== generation) return;
									Lampa.Loading.stop();
									_this.getFileUrl(file, call, true);
								}, function () {
									if (destroyed || cancelled || token !== generation) return;
									Lampa.Loading.stop();
									call(false, {});
								});
							}
						} else {
							Lampa.Loading.stop();
							call(json, json);
						}
					},
					function () {
						if (destroyed || cancelled || token !== generation) return;
						Lampa.Loading.stop();
						call(false, {});
					}
				);
			}
		};

		this.toPlayElement = PlayerAdapter.toPlayElement;

		this.orUrlReserve = PlayerAdapter.orUrlReserve;

		this.setDefaultQuality = PlayerAdapter.setDefaultQuality;

		this.display = function (videos) {
			var _this5 = this;
			this.draw(videos, {
				onEnter: function onEnter(item, html) {
					_this5.getFileUrl(
						item,
						function (json, json_call) {
							if (json && json.url) {
								var playlist = [];
								var first = _this5.toPlayElement(item, json, json_call);
								_this5.orUrlReserve(first);
								_this5.setDefaultQuality(first);
								if (item.season) {
									videos.forEach(function (elem) {
										var cell = _this5.toPlayElement(elem);
										if (elem == item) {
											cell = _this5.toPlayElement(elem, json, json_call);
										} else {
											if (elem.method == "call") {
												if (Lampa.Storage.field("player") !== "inner" && !elem.rezka) {
													cell.url = elem.stream;
													delete cell.quality;
												} else {
													cell.url = function (call) {
														_this5.getFileUrl(
															elem,
															function (stream, stream_json) {
																if (stream && stream.url) {
																	$.extend(cell, _this5.toPlayElement(elem, stream, stream_json));
																	_this5.orUrlReserve(cell);
																	_this5.setDefaultQuality(cell);
																	elem.mark();
																} else {
																	cell.url = "";
																	Lampa.Noty.show(
																		Lampa.Lang.translate("lampac_nolink")
																	);
																}
																call();
																if (cell.url && cell.subtitles_call) _this5.loadSubtitles(cell.subtitles_call, cell);
															}
														);
													};
												}
											} else {
												cell.url = elem.url;
											}
										}
										_this5.orUrlReserve(cell);
										_this5.setDefaultQuality(cell);
										playlist.push(cell);
									});
								} else {
									playlist.push(first);
								}
								if (playlist.length > 1) first.playlist = playlist;
								if (first.url) {
									var element = first;
									element.isonline = true;
									Lampa.Player.play(element);
									Lampa.Player.playlist(playlist);
									if (element.subtitles_call)
										_this5.loadSubtitles(element.subtitles_call, element);
									item.mark();
									_this5.updateBalanser(balanser);
								} else {
									Lampa.Noty.show(Lampa.Lang.translate("lampac_nolink"));
								}
							} else Lampa.Noty.show(Lampa.Lang.translate("lampac_nolink"));
						}
					);
				},
				onContextMenu: function onContextMenu(item, html, data, call) {
					_this5.getFileUrl(
						item,
						function (stream) {
							call({
								file: stream && stream.url,
								quality: item.qualitys
							});
						}
					);
				}
			});
			this.filter(
				{
					season: filter_find.season.map(function (s) {
						return s.title;
					}),
					voice: filter_find.voice.map(function (b) {
						return b.title;
					})
				},
				this.getChoice()
			);
		};

		this.loadSubtitles = PlayerAdapter.loadSubtitles;

		this.parse = function (str) {
			if (destroyed) return;
			var json = Lampa.Arrays.decodeJson(str, {});
			if (Lampa.Arrays.isObject(str) && str.rch) json = str;
			if (json && json.rch) return this.rch(json);
			if (json && json.accsdb) return this.doesNotAnswer(json);

			try {
				var items = this.parseJsonDate(str, ".videos__item");
				var buttons = this.parseJsonDate(str, ".videos__button");

				if (
					items.length == 1 &&
					items[0].method == "link" &&
					!items[0].similar
				) {
					filter_find.season = items.map(function (s) {
						return {
							title: s.text,
							url: s.url
						};
					});
					this.replaceChoice({
						season: 0
					});
					this.request(items[0].url);
				} else {
					this.activity.loader(false);
					var videos = items.filter(function (v) {
						return v.method == "play" || v.method == "call";
					});
					var similar = items.filter(function (v) {
						return v.similar;
					});

					if (videos.length) {
						if (buttons.length) {
							filter_find.voice = buttons.map(function (b) {
								return {
									title: b.text,
									url: b.url
								};
							});
							var select_voice_url = this.getChoice(balanser).voice_url;
							var select_voice_name = this.getChoice(balanser).voice_name;
							var find_voice_url = null;
							var find_voice_name = null;
							var find_voice_active = null;
							for (var i = 0; i < buttons.length; i++) {
								var v = buttons[i];
								if (!find_voice_url && v.url == select_voice_url)
									find_voice_url = v;
								if (!find_voice_name && v.text == select_voice_name)
									find_voice_name = v;
								if (!find_voice_active && v.active) find_voice_active = v;
								if (find_voice_url && find_voice_name && find_voice_active)
									break;
							}
							if (find_voice_url && !find_voice_url.active) {
								this.replaceChoice({
									voice: buttons.indexOf(find_voice_url),
									voice_name: find_voice_url.text
								});
								this.request(find_voice_url.url);
							} else if (find_voice_name && !find_voice_name.active) {
								this.replaceChoice({
									voice: buttons.indexOf(find_voice_name),
									voice_name: find_voice_name.text
								});
								this.request(find_voice_name.url);
							} else {
								if (find_voice_active) {
									this.replaceChoice({
										voice: buttons.indexOf(find_voice_active),
										voice_name: find_voice_active.text
									});
								}
								this.display(videos);
							}
						} else {
							this.replaceChoice({
								voice: 0,
								voice_url: "",
								voice_name: ""
							});
							this.display(videos);
						}
					} else if (items.length) {
						if (similar.length) {
							this.similars(similar);
							this.activity.loader(false);
						} else {
							filter_find.season = items.map(function (s) {
								return {
									title: s.text,
									url: s.url
								};
							});
							var select_season = this.getChoice(balanser).season;
							var season = filter_find.season[select_season];
							if (!season) season = filter_find.season[0];
							this.request(season.url);
						}
					} else {
						this.doesNotAnswer(json);
					}
				}
			} catch (e) {
				this.doesNotAnswer(e);
			}
		};

		this.similars = function (json) {
			this.clearImages();
			var _this6 = this;
			var fragment = document.createDocumentFragment();
			json.forEach(function (elem) {
				elem.title = elem.text;
				elem.info = "";
				var info = [];
				var year = (
					(elem.start_date ||
						elem.year ||
						object.movie.release_date ||
						object.movie.first_air_date ||
						"") + ""
				).slice(0, 4);
				if (year) info.push(year);
				if (elem.details) info.push(elem.details);
				var name = elem.title || elem.text;
				elem.title = name;
				elem.time = elem.time || "";
				elem.info = formatCardInfo(info);
				var item = $(Lampa.Template.js("lampac_prestige_folder", elem));
				if (typeof elem.img === "string" && elem.img) {
					var image = $('<img class="lampac-similar-img"/>');
					var img = image[0];
					item.find(".online-prestige__folder").empty().append(image);

					if (elem.img !== undefined) {
						if (elem.img.charAt(0) === "/")
							elem.img = Config.Urls.getLocalhost() + elem.img.substring(1);
						if (elem.img.indexOf("/proxyimg") !== -1)
							elem.img = account(elem.img);
					}

					loadImage(img, elem.img, function () {
						image.addClass("loaded");
					}, images);
				}
				item
					.on("hover:enter", function () {
						_this6.reset();
						_this6.request(elem.url);
					})
					.on("hover:focus", function (e) {
						last = e.target;
						scroll.update($(e.target), true);
					});
				if (item && item[0]) fragment.appendChild(item[0]);
			});
			scroll.clear();
			scroll.body()[0].appendChild(fragment);
			this.filter(
				{
					season: filter_find.season.map(function (s) {
						return s.title;
					}),
					voice: filter_find.voice.map(function (b) {
						return b.title;
					})
				},
				this.getChoice()
			);
			Lampa.Controller.enable("content");
		};

		this.getChoice = StateManager.getChoice;

		this.saveChoice = StateManager.saveChoice;

		this.replaceChoice = StateManager.replaceChoice;

		function loadImage(img, url, ready, collection) {
			function complete() {
				img.onload = null;
				img.onerror = null;
				if (!destroyed) ready();
			}
			collection.push(img);
			Lampa.Utils.imgLoad(img, url, complete, complete);
		}

		this.clearImages = function () {
			images.forEach(function (img) {
				if (!img) return;
				try {
					img.onerror = null;
					img.onload = null;
					img.removeAttribute("src");
				} catch (e) {
					console.error(e);
				}
			});
			images = [];
		};

		this.reset = function () {
			if (destroyed) return;
			generation++;
			number_of_requests = 0;
			last = false;
			clearInterval(balanser_timer);
			clearTimeout(life_wait_timer);
			clearTimeout(number_of_requests_timer);
			clearTimeout(select_close_timer);
			clearNetworks();
			rezka.clear();
			this.clearImages();
			scroll.render().find(".empty").remove();
			scroll.clear();
			scroll.reset();
			scroll.body().append(Lampa.Template.get("lampac_content_loading"));
		};

		this.loading = function (status) {
			if (status) this.activity.loader(true);
			else {
				this.activity.loader(false);
				this.activity.toggle();
			}
		};

		this.filter = function (filter_items, choice) {
			var _this7 = this;
			var select = [];
			var add = function add(type, title) {
				var need = _this7.getChoice();
				var items = filter_items[type];
				var subitems = [];
				var value = need[type];
				items.forEach(function (name, i) {
					subitems.push({
						title: safeUiText(name),
						selected: value == i,
						index: i
					});
				});
				select.push({
					title: title,
					subtitle: safeUiText(items[value]),
					items: subitems,
					stype: type
				});
			};
			filter_items.source = filter_sources;
			select.push({
				title: Lampa.Lang.translate("torrent_parser_reset"),
				reset: true
			});
			select.push({
				title: Lampa.Lang.translate("lampac_server_short"),
				subtitle: safeUiText(getCurrentServerDisplay()),
				selected: true,
				stype: "server"
			});
			select.push({
				title: Lampa.Lang.translate("settings_rest_source"),
				stype: "source"
			});
			if (balanser) this.saveChoice(choice);
			if (filter_items.voice && filter_items.voice.length)
				add("voice", Lampa.Lang.translate("torrent_parser_voice"));
			if (filter_items.season && filter_items.season.length)
				add("season", Lampa.Lang.translate("torrent_serial_season"));
			select.push({
				title: "Обработка m3u8",
				subtitle: getHlsType() === "auto" ? "Автоматически" : getHlsType() === "native" ? "Системная" : getHlsType() === "hlsjs" ? "hls.js" : "Как в настройках Lampa",
				items: [
					{ title: "Как в настройках Lampa", value: "", selected: getHlsType() === "" },
					{ title: "Автоматически", value: "auto", selected: getHlsType() === "auto" },
					{ title: "hls.js", value: "hlsjs", selected: getHlsType() === "hlsjs" },
					{ title: "Системная", value: "native", selected: getHlsType() === "native" }
				],
				stype: "hls"
			});
			filter.set("filter", select);
			updateSourceItems();
			filter.chosen("server", [safeUiText(getCurrentServerDisplay())]);
			this.selected(filter_items);
		};

		this.selected = function (filter_items) {
			var need = this.getChoice(),
				select = [];
			for (var i in need) {
				if (filter_items[i] && filter_items[i].length) {
					if (i == "voice") {
						select.push(filter_translate[i] + ": " + safeUiText(filter_items[i][need[i]]));
					} else if (i !== "source") {
						if (filter_items.season.length >= 1) {
							select.push(
								filter_translate.season + ": " + safeUiText(filter_items[i][need[i]])
							);
						}
					}
				}
			}
			filter.chosen("filter", select);
			filter.chosen("sort", [selectedSourceTitle()]);
		};

		this.getEpisodes = function (season, call) {
			if (destroyed) return;
			var token = generation;
			var request_token = request_generation;
			var episodes = [];
			var tmdb_id = object.movie.id;
			if (["cub", "tmdb"].indexOf(object.movie.source || "tmdb") == -1)
				tmdb_id = object.movie.tmdb_id;
			if (typeof tmdb_id == "number" && object.movie.name) {
				Lampa.Api.sources.tmdb.get(
					"tv/" + tmdb_id + "/season/" + season,
					{},
					function (data) {
						if (destroyed || token !== generation || request_token !== request_generation) return;
						episodes = data && Array.isArray(data.episodes) ? data.episodes.filter(function (episode) {
							return episode && typeof episode === "object";
						}) : [];
						call(episodes);
					},
					function () {
						if (destroyed || token !== generation || request_token !== request_generation) return;
						call(episodes);
					}
				);
			} else call(episodes);
		};

		this.watched = function (set) {
			if (set) {
				StateManager.watched(set);
				this.updateWatched();
			} else {
				return StateManager.watched();
			}
		};

		this.updateWatched = function () {
			var watched = this.watched();
			var body = scroll
				.body()
				.find(".online-prestige-watched .online-prestige-watched__body")
				.empty();
			if (watched) {
				var line = [];
				if (watched.balanser_name) line.push(watched.balanser_name);
				if (watched.voice_name) line.push(watched.voice_name);
				if (watched.season)
					line.push(
						Lampa.Lang.translate("torrent_serial_season") + " " + watched.season
					);
				if (watched.episode)
					line.push(
						Lampa.Lang.translate("torrent_serial_episode") +
							" " +
							watched.episode
					);
				line.forEach(function (n) {
					body.append($("<span>").text(n));
				});
			} else
				body.append(
					"<span>" + Lampa.Lang.translate("lampac_no_watch_history") + "</span>"
				);
		};

		function fileHash(season, episode, voice) {
			var title = object.movie.original_name || object.movie.original_title;
			return Lampa.Utils.hash((episode
				? [season, season > 10 ? ":" : "", episode, title].join("")
				: title) + (voice || ""));
		}

		this.draw = function (items) {
			var _this8 = this;
			var params =
				arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
			if (!items.length) return this.empty();
			this.getEpisodes(items[0].season, function (episodes) {
				if (destroyed) return;
				var viewed = storageCache(
					Config.StorageKeys.OnlineView,
					5000,
					[]
				);
				var serial = object.movie.name ? true : false;
				var choice = _this8.getChoice();
				var fully = window.innerWidth > 480;
				var scroll_to_element = false;
				var scroll_to_mark = false;
				var fragment = document.createDocumentFragment();
				var new_images = [];
				items.forEach(function (element, index) {
					var episode = false;
					if (serial && episodes.length && !params.similars) {
						for (var ei = 0; ei < episodes.length; ei++) {
							if (episodes[ei].episode_number == element.episode) {
								episode = episodes[ei];
								break;
							}
						}
					}
					var episode_num = element.episode || index + 1;
					var episode_last = choice.episodes_view[element.season];
					var voice_name =
						choice.voice_name ||
						(filter_find.voice[0] ? filter_find.voice[0].title : false) ||
						element.voice_name ||
						(serial ? "Неизвестно" : element.text) ||
						"Неизвестно";
					if (element.quality) {
						element.qualitys = element.quality;
						element.quality = Lampa.Arrays.getKeys(element.quality)[0];
					}
					Lampa.Arrays.extend(element, {
						voice_name: voice_name,
						info:
							voice_name.length > 60
								? voice_name.substr(0, 60) + "..."
								: voice_name,
						quality: "",
						time: Lampa.Utils.secondsToTime(
							(episode ? episode.runtime : object.movie.runtime) * 60,
							true
						)
					});
					var hash_timeline = fileHash(element.season, element.episode);
					var hash_behold = fileHash(element.season, element.episode, element.voice_name);
					var data = {
						hash_timeline: hash_timeline,
						hash_behold: hash_behold
					};
					var info = [];
					if (element.season) {
						element.translate_episode_end = _this8.getLastEpisode(items);
						element.translate_voice = element.voice_name;
					}
					if (element.text && !episode) element.title = element.text;
					element.timeline = Lampa.Timeline.view(hash_timeline);
					if (episode) {
						element.title = episode.name;
						if (element.info.length < 30 && episode.vote_average)
							info.push(
								Lampa.Template.js(
									"lampac_prestige_rate",
									{
										rate: parseFloat(episode.vote_average + "").toFixed(1)
									}
								)
							);
						if (episode.air_date && fully)
							info.push(Lampa.Utils.parseTime(episode.air_date).full);
					} else if (object.movie.release_date && fully) {
						info.push(Lampa.Utils.parseTime(object.movie.release_date).full);
					}
					if (!serial && object.movie.tagline && element.info.length < 30)
						info.push(object.movie.tagline);
					if (element.info) info.push(element.info);
					var html = $(Lampa.Template.js("lampac_prestige_full", $.extend({}, element, {
						info: info.length ? formatCardInfo(info, true) : element.info
					})));
					var loader = html.find(".online-prestige__loader");
					var image = html.find(".online-prestige__img");
					if (object.balanser) image.hide();
					if (!serial) {
						if (choice.movie_view == hash_behold) scroll_to_element = html;
					} else if (
						typeof episode_last !== "undefined" &&
						episode_last == episode_num
					) {
						scroll_to_element = html;
					}
					if (serial && !episode) {
						image.append(
							'<div class="online-prestige__episode-number">' +
								("0" + (element.episode || index + 1)).slice(-2) +
								"</div>"
						);
						loader.remove();
					} else if (!serial && object.movie.backdrop_path == "undefined")
						loader.remove();
					else {
						var img = html.find("img")[0];
						loadImage(img, Lampa.TMDB.image(
							"t/p/w300" + (episode ? episode.still_path : object.movie.backdrop_path)
						), function () {
							image.addClass("online-prestige__img--loaded loaded");
							loader.remove();
							if (serial) image.append(
								'<div class="online-prestige__episode-number">' +
									("0" + (element.episode || index + 1)).slice(-2) + "</div>"
							);
						}, new_images);
					}
					html
						.find(".online-prestige__timeline")
						.append(Lampa.Timeline.render(element.timeline));
					if (viewed.indexOf(hash_behold) !== -1) {
						scroll_to_mark = html;
						html
							.find(".online-prestige__img")
							.append(
								'<div class="online-prestige__viewed">' +
									Lampa.Template.get("icon_viewed", {}, true) +
									"</div>"
							);
					}
					element.mark = function () {
						viewed = storageCache(
							Config.StorageKeys.OnlineView,
							5000,
							[]
						);
						if (viewed.indexOf(hash_behold) == -1) {
							viewed.push(hash_behold);
							Lampa.Storage.set(Config.StorageKeys.OnlineView, viewed);
							if (html.find(".online-prestige__viewed").length == 0) {
								html
									.find(".online-prestige__img")
									.append(
										'<div class="online-prestige__viewed">' +
											Lampa.Template.get("icon_viewed", {}, true) +
											"</div>"
									);
							}
						}
						choice = _this8.getChoice();
						if (!serial) {
							choice.movie_view = hash_behold;
						} else {
							choice.episodes_view[element.season] = episode_num;
						}
						_this8.saveChoice(choice);
						var voice_name_text =
							choice.voice_name || element.voice_name || element.title;
						if (voice_name_text.length > 30)
							voice_name_text = voice_name_text.slice(0, 30) + "...";
						_this8.watched({
							balanser: balanser,
							balanser_name: Lampa.Utils.capitalizeFirstLetter(
								sources[balanser]
									? sources[balanser].name.split(" ")[0]
									: balanser
							),
							voice_id: choice.voice_id,
							voice_name: voice_name_text,
							episode: element.episode,
							season: element.season
						});
					};
					element.unmark = function () {
						viewed = storageCache(
							Config.StorageKeys.OnlineView,
							5000,
							[]
						);
						if (viewed.indexOf(hash_behold) !== -1) {
							Lampa.Arrays.remove(viewed, hash_behold);
							Lampa.Storage.set(Config.StorageKeys.OnlineView, viewed);
							Lampa.Storage.remove(Config.StorageKeys.OnlineView, hash_behold);
							html.find(".online-prestige__viewed").remove();
						}
					};
					element.timeclear = function () {
						element.timeline.percent = 0;
						element.timeline.time = 0;
						element.timeline.duration = 0;
						Lampa.Timeline.update(element.timeline);
					};
					html
						.on("hover:enter", function () {
							if (object.movie.id)
								Lampa.Favorite.add("history", object.movie, 100);
							if (params.onEnter) params.onEnter(element, html, data);
						})
						.on("hover:focus", function (e) {
							last = e.target;
							if (params.onFocus) params.onFocus(element, html, data);
							scroll.update($(e.target), true);
						});
					if (params.onRender) params.onRender(element, html, data);
					_this8.contextMenu({
						html: html,
						element: element,
						onFile: function onFile(call) {
							if (params.onContextMenu)
								params.onContextMenu(element, html, data, call);
						},
						onClearAllMark: function onClearAllMark() {
							items.forEach(function (elem) {
								elem.unmark();
							});
						},
						onClearAllTime: function onClearAllTime() {
							items.forEach(function (elem) {
								elem.timeclear();
							});
						}
					});
					if (html && html[0]) fragment.appendChild(html[0]);
				});
				if (serial && episodes.length && !params.similars) {
					var left = episodes.filter(function (episode) {
						return !items.some(function (item) { return item.episode == episode.episode_number; });
					});
					var days_left_title = Lampa.Lang.translate("full_episode_days_left");
					left.forEach(function (episode) {
						var info = [];
						if (episode.vote_average)
							info.push(
								Lampa.Template.js(
									"lampac_prestige_rate",
									{
										rate: parseFloat(episode.vote_average + "").toFixed(1)
									}
								)
							);
						if (episode.air_date)
							info.push(Lampa.Utils.parseTime(episode.air_date).full);
						var air = new Date((episode.air_date + "").replace(/-/g, "/"));
						var now = Date.now();
						var day = Math.round((air.getTime() - now) / (24 * 60 * 60 * 1000));
						var txt = days_left_title + ": " + day;
						var html = $(Lampa.Template.js("lampac_prestige_full", {
							time: Lampa.Utils.secondsToTime(
								(episode ? episode.runtime : object.movie.runtime) * 60,
								true
							),
							info: formatCardInfo(info, true),
							title: episode.name,
							quality: day > 0 ? txt : ""
						}));
						var loader = html.find(".online-prestige__loader");
						var image = html.find(".online-prestige__img");
						var season = items[0] ? items[0].season : 1;
						html
							.find(".online-prestige__timeline")
							.append(
								Lampa.Timeline.render(
									Lampa.Timeline.view(
										fileHash(season, episode.episode_number)
									)
								)
							);
						var img = html.find("img")[0];
						if (episode.still_path) {
							loadImage(img, Lampa.TMDB.image("t/p/w300" + episode.still_path), function () {
								image.addClass("online-prestige__img--loaded loaded");
								loader.remove();
								image.append(
									'<div class="online-prestige__episode-number">' +
										("0" + episode.episode_number).slice(-2) + "</div>"
								);
							}, new_images);
						} else {
							loader.remove();
							image.append(
								'<div class="online-prestige__episode-number">' +
									("0" + episode.episode_number).slice(-2) +
									"</div>"
							);
						}
						html.on("hover:focus", function (e) {
							last = e.target;
							scroll.update($(e.target), true);
						});
						html.addClass("lampac-dim-opacity");
						if (html && html[0]) fragment.appendChild(html[0]);
					});
				}
				scroll.clear();
				_this8.clearImages();

				try {
					if (!object.balanser)
						scroll.append(Lampa.Template.get("lampac_prestige_watched", {}));
				} catch (e) {
					initTemplates();
					if (!object.balanser)
						scroll.append(Lampa.Template.get("lampac_prestige_watched", {}));
				}

				_this8.updateWatched();
				scroll.body()[0].appendChild(fragment);
				images = new_images;
				if (scroll_to_element) {
					last = scroll_to_element[0];
				} else if (scroll_to_mark) {
					last = scroll_to_mark[0];
				}
				Lampa.Controller.enable("content");
			});
		};

		this.contextMenu = function (params) {
			params.html
				.on("hover:long", function () {
					function show(extra) {
						var enabled = Lampa.Controller.enabled().name;
						var menu = [];
						if (Lampa.Platform.is("webos")) {
							menu.push({
								title: Lampa.Lang.translate("player_lauch") + " - Webos",
								player: "webos"
							});
						}
						if (Lampa.Platform.is("android")) {
							menu.push({
								title: Lampa.Lang.translate("player_lauch") + " - Android",
								player: "android"
							});
						}
						menu.push({
							title: Lampa.Lang.translate("player_lauch") + " - Lampa",
							player: "lampa"
						});
						menu.push({
							title: Lampa.Lang.translate("lampac_video"),
							separator: true
						});
						menu.push({
							title: Lampa.Lang.translate("torrent_parser_label_title"),
							mark: true
						});
						menu.push({
							title: Lampa.Lang.translate("torrent_parser_label_cancel_title"),
							unmark: true
						});
						menu.push({
							title: Lampa.Lang.translate("time_reset"),
							timeclear: true
						});
						if (extra) {
							menu.push({
								title: Lampa.Lang.translate("copy_link"),
								copylink: true
							});
						}
						if (window.lampac_online_context_menu)
							window.lampac_online_context_menu.push(menu, extra, params);
						menu.push({
							title: Lampa.Lang.translate("more"),
							separator: true
						});
						if (
							Lampa.Account.logged() &&
							params.element &&
							typeof params.element.season !== "undefined" &&
							params.element.translate_voice
						) {
							menu.push({
								title: Lampa.Lang.translate("lampac_voice_subscribe"),
								subscribe: true
							});
						}
						menu.push({
							title: Lampa.Lang.translate("lampac_clear_all_marks"),
							clearallmark: true
						});
						menu.push({
							title: Lampa.Lang.translate("lampac_clear_all_timecodes"),
							timeclearall: true
						});
						Lampa.Select.show({
							title: Lampa.Lang.translate("title_action"),
							items: menu,
							onBack: function onBack() {
								Lampa.Controller.toggle(enabled);
							},
							onSelect: function onSelect(a) {
								if (a.mark) params.element.mark();
								if (a.unmark) params.element.unmark();
								if (a.timeclear) params.element.timeclear();
								if (a.clearallmark) params.onClearAllMark();
								if (a.timeclearall) params.onClearAllTime();
								if (window.lampac_online_context_menu)
									window.lampac_online_context_menu.onSelect(a, params);
								Lampa.Controller.toggle(enabled);
								if (a.player) {
									Lampa.Player.runas(a.player);
									params.html.trigger("hover:enter");
								}
								if (a.copylink) {
									if (extra.quality) {
										var qual = [];
										for (var i in extra.quality) {
											qual.push({
												title: safeUiText(i),
												file: extra.quality[i]
											});
										}
										Lampa.Select.show({
											title: Lampa.Lang.translate("settings_server_links"),
											items: qual,
											onBack: function onBack() {
												Lampa.Controller.toggle(enabled);
											},
											onSelect: function onSelect(b) {
												Lampa.Utils.copyTextToClipboard(
													b.file,
													function () {
														Lampa.Noty.show(
															Lampa.Lang.translate("copy_secuses")
														);
													},
													function () {
														Lampa.Noty.show(Lampa.Lang.translate("copy_error"));
													}
												);
											}
										});
									} else {
										Lampa.Utils.copyTextToClipboard(
											extra.file,
											function () {
												Lampa.Noty.show(Lampa.Lang.translate("copy_secuses"));
											},
											function () {
												Lampa.Noty.show(Lampa.Lang.translate("copy_error"));
											}
										);
									}
								}
								if (a.subscribe) {
									Lampa.Account.subscribeToTranslation(
										{
											card: object.movie,
											season: params.element.season,
											episode: params.element.translate_episode_end,
											voice: params.element.translate_voice
										},
										function () {
											Lampa.Noty.show(
												Lampa.Lang.translate("lampac_voice_success")
											);
										},
										function () {
											Lampa.Noty.show(
												Lampa.Lang.translate("lampac_voice_error")
											);
										}
									);
								}
							}
						});
					}
					params.onFile(show);
				})
				.on("hover:focus", function () {
					if (Lampa.Helper)
						Lampa.Helper.show(
							"online_file",
							Lampa.Lang.translate("helper_online_file"),
							params.html
						);
				});
		};

		this.empty = function () {
			var html = Lampa.Template.get("lampac_does_not_answer", {});
			html.find(".cancel").on("hover:enter", function () {
				Lampa.Activity.backward();
			});
			html.find(".change").on("hover:enter", function () {
				filter.show(Lampa.Lang.translate("lampac_balanser"), "sort");
			});
			html
				.find(".online-empty__title")
				.text(Lampa.Lang.translate("empty_title_two"));
			html.find(".online-empty__time").text(Lampa.Lang.translate("empty_text"));
			scroll.clear();
			scroll.append(html);
			this.loading(false);
		};

		this.noConnectToServer = function (er) {
			if (destroyed) return;
			var bwaMessage = bwaAccessMessage(er);
			var html = Lampa.Template.get("lampac_does_not_answer", {});
			html.find(".cancel").on("hover:enter", function () {
				Lampa.Activity.backward();
			});
			html.find(".change").text(bwaMessage ? "Настроить BWA" : "Выбрать сервер").on("hover:enter", function () {
				if (bwaMessage) openBwaInput();
				else openServerMenu();
			});
			html
				.find(".online-empty__title")
				.text(er && er.accsdb ? Lampa.Lang.translate("title_error") : Lampa.Lang.translate("lampac_server_unavailable"));
			html
				.find(".online-empty__time")
				.text(
					bwaMessage ? bwaMessage : er && er.accsdb
						? er.msg
						: Lampa.Lang.translate("lampac_server_unavailable_desc")
				);
			scroll.clear();
			scroll.append(html);
			this.loading(false);
		};

		this.doesNotAnswer = function (er) {
			if (destroyed) return;
			if (bwaAccessMessage(er)) return this.noConnectToServer(er);
			var _this9 = this;
			this.reset();
			var html = Lampa.Template.get("lampac_does_not_answer", {
				balanser: balanser
			});
			if (er && er.accsdb) html.find(".online-empty__title").text(er.msg);
			var bwaRezka = isBwaServer(getServerUrl()) && balanser === "rezka";
			if (bwaRezka && !(er && er.accsdb)) {
				html.find(".online-empty__title").text("Rezka через BWA не вернула видео");
				html.find(".online-empty__time").text("Проверьте Cookie и зеркало Rezka в BWA Kit: укажите сайт, с которого взяты Cookie. Без Cookie источник может требовать вход или проверку защиты сайта.");
			}

			var tic = bwaRezka || er && er.accsdb ? 10 : 5;
			html.find(".cancel").on("hover:enter", function () {
				clearInterval(balanser_timer);
			});
			html.find(".change").on("hover:enter", function () {
				clearInterval(balanser_timer);
				filter.render().find(".filter--sort").trigger("hover:enter");
			});
			scroll.clear();
			scroll.append(html);
			this.loading(false);
			balanser_timer = setInterval(function () {
				if (destroyed) return;
				tic--;
				html.find(".timeout").text(tic);
				if (tic == 0) {
					clearInterval(balanser_timer);
					var keys = Lampa.Arrays.getKeys(sources);
					var indx = keys.indexOf(balanser);
					var next = keys[indx + 1];
					if (!next) next = keys[0];
					if (!next) return;
					balanser = next;
					var active = Lampa.Activity.active();
					if (active && active.activity == _this9.activity)
						_this9.changeBalanser(balanser);
				}
			}, 1000);
		};

		this.getLastEpisode = function (items) {
			var last_episode = 0;
			items.forEach(function (e) {
				var episode = e && parseInt(e.episode, 10);
				if (isFinite(episode)) last_episode = Math.max(last_episode, episode);
			});
			return last_episode;
		};

		function safeLastFocus() {
			if (!last) return false;
			try {
				var render = files.render();
				if (
					render &&
					render[0] &&
					render[0].contains &&
					!render[0].contains(last)
				)
					return false;
			} catch (e) {
				console.error(e);
				return false;
			}
			return last;
		}

		this.start = function () {
			if (destroyed) return;
			var active = Lampa.Activity.active();
			if (!active || active.activity !== this.activity) return;
			if (!initialized) {
				initialized = true;
				this.initialize();
			}
			Lampa.Background.immediately(
				Lampa.Utils.cardImgBackgroundBlur(object.movie)
			);
			Lampa.Controller.add("content", {
				toggle: function toggle() {
					if (refreshAfterSetup()) return;
					Lampa.Controller.collectionSet(files.render(), false, true);
					Lampa.Controller.collectionFocus(safeLastFocus(), scroll.render().find(".selector:visible").length ? scroll.render() : filter.render(), true);
				},
				gone: function gone() {
					clearInterval(balanser_timer);
				},
				up: function up() {
					if (Navigator.canmove("up")) {
						Navigator.move("up");
					} else Lampa.Controller.toggle("head");
				},
				down: function down() {
					Navigator.move("down");
				},
				right: function right() {
					if (Navigator.canmove("right")) Navigator.move("right");
					else filter.show(Lampa.Lang.translate("title_filter"), "filter");
				},
				left: function left() {
					if (Navigator.canmove("left")) Navigator.move("left");
					else Lampa.Controller.toggle("menu");
				},
				back: this.back.bind(this)
			});
			Lampa.Controller.toggle("content");
		};

		this.render = function () {
			return files.render();
		};

		this.back = function () {
			Lampa.Activity.backward();
		};

		this.pause = function () {};
		this.stop = function () {};
		this.destroy = function () {
			if (destroyed) return;
			destroyed = true;
			clearTimeout(refresh_timer);
			Lampa.Settings.listener.remove("close", refreshAfterSetup);
			generation++;
			clearInterval(balanser_timer);
			clearTimeout(life_wait_timer);
			clearTimeout(number_of_requests_timer);
			clearTimeout(select_close_timer);
			rezka.clear();
			last = false;
			clearNetworks();
			this.clearImages();
			filter.destroy();
			files.destroy();
			scroll.destroy();
		};
	}

	function addSourceSearch(spiderName, spiderUri) {
		var network = new Lampa.Reguest();
		var generation = 0;

		var source = {
			title: spiderName,
			search: function (params, oncomplite) {
				var token = ++generation;
				network.clear();
				var query = encodeURIComponent(params && params.query != null ? String(params.query) : "");
				function searchComplite(links) {
					if (token !== generation) return;
					var keys = links && typeof links === "object" && !Array.isArray(links)
						? Object.keys(links).filter(function (name) { return typeof links[name] === "string" && !!links[name]; }) : [];

					if (keys.length) {
						var status = new Lampa.Status(keys.length);

						status.onComplite = function (result) {
							if (token !== generation) return;
							var rows = [];

							keys.forEach(function (name) {
								var line = result[name];

								if (line && Array.isArray(line.data) && line.type == "similar") {
									var cards = line.data.filter(function (item) {
										return item && typeof item.title === "string" && typeof item.url === "string" && !!item.url;
									}).map(function (item) {
										item.title = Lampa.Utils.capitalizeFirstLetter(item.title);
										item.release_date = item.year || "0000";
										item.balanser = spiderUri;
										if (typeof item.img === "string") {
											if (item.img.charAt(0) === "/")
												item.img =
													Config.Urls.getLocalhost() + item.img.substring(1);
											if (item.img.indexOf("/proxyimg") !== -1)
												item.img = account(item.img);
										}

										return item;
									});

									rows.push({
										title: name,
										results: cards
									});
								}
							});

							oncomplite(rows);
						};

						keys.forEach(function (name) {
							serverRequest(network, "silent",
								account(links[name]),
								function (data) {
									if (token !== generation) return;
									status.append(name, data);
								},
								function () {
									if (token !== generation) return;
									status.error();
								}
							);
						});
					} else {
						oncomplite([]);
					}
				}

				serverRequest(network, "silent",
					account(
						Config.Urls.getLocalhost() +
							"lite/" +
							spiderUri +
							"?title=" +
							query
					),
					function (json) {
						if (token !== generation) return;
						if (json && json.rch) {
							rchRun(json, function () {
								if (token !== generation) return;
							serverRequest(network, "silent",
									account(
										Config.Urls.getLocalhost() +
											"lite/" +
											spiderUri +
											"?title=" +
											query
									),
									function (links) {
										searchComplite(links);
									},
									function () {
										if (token !== generation) return;
										oncomplite([]);
									}
								);
							}, function () {
								if (token !== generation) return;
								oncomplite([]);
							});
						} else {
							searchComplite(json);
						}
					},
					function () {
						if (token !== generation) return;
						oncomplite([]);
					}
				);
			},
			onCancel: function () {
				generation++;
				network.clear();
			},
			params: {
				lazy: true,
				align_left: true,
				card_events: {
					onMenu: function () {}
				}
			},
			onMore: function (params, close) {
				close();
			},
			onSelect: function (params, close) {
				close();

				Lampa.Activity.push({
					url: params.element.url,
					title: "Lampac - " + params.element.title,
					component: "lamponline",
					movie: params.element,
					page: 1,
					search: params.element.title,
					clarification: true,
					balanser: params.element.balanser,
					noinfo: true
				});
			}
		};

		Lampa.Search.addSource(source);
	}

	var restorePlayerBuffer;

	function initPlayerBuffer() {
		if (restorePlayerBuffer) restorePlayerBuffer();
		if (!Lampa.Player || typeof Lampa.Player.playdata !== "function") return;
		var data = Lampa.Player.playdata();
		if (!data || !data.lamponline_stream) return;
		var player = Lampa.PlayerVideo;
		if (!player || !player.listener || typeof player.listener.send !== "function") return;
		var prototype = window.Hls && window.Hls.prototype;
		var patchedLoadSource;
		if (prototype && typeof prototype.loadSource === "function") {
			var loadSource = prototype.loadSource;
			patchedLoadSource = prototype.loadSource = function () {
				var data = Lampa.Player.playdata();
				if (data && data.lamponline_stream && this.config) {
					this.config.maxBufferLength = 360;
					this.config.maxMaxBufferLength = 360;
					this.config.maxBufferSize = 360000000;
				}
				return loadSource.apply(this, arguments);
			};
		}

		var send = player.listener.send;
		var attempt;
		var armTimer;

		function clearAttempt() {
			if (attempt) clearTimeout(attempt.timer);
			attempt = null;
		}

		function retryHls() {
			var failed = attempt;
			if (!failed || failed.started || failed.retried || failed.data !== Lampa.Player.playdata()) return false;
			if (failed.pending) return true;
			failed.pending = true;
			clearTimeout(failed.timer);
			failed.timer = setTimeout(function () {
				if (attempt !== failed || failed.data !== Lampa.Player.playdata()) return;
				clearAttempt();
				player.destroy(true);
				failed.data.hls_type = failed.type === "native" ? "hlsjs" : "native";
				attempt = failed;
				failed.retried = true;
				failed.pending = false;
				player.url(failed.src);
			}, 0);
			return true;
		}

		function armAutoHls(data) {
			if (attempt || !data || !data.lamponline_stream || !data.lamponline_hls_auto || !/\.m3u8/.test(data.url)) return;
			attempt = {
				data: data,
				src: data.url,
				type: data.hls_type,
				retried: false,
				started: false,
				pending: false
			};
			attempt.timer = setTimeout(retryHls, Math.max(30000, Number(data.hls_manifest_timeout) || 0));
		}
		function onVideoDestroy() {
			clearAttempt();
			clearTimeout(armTimer);
			armTimer = setTimeout(function () {
				armAutoHls(Lampa.Player.playdata());
			}, 10);
		}
		armAutoHls(data);
		var listener = player.listener;
		function onLoadedData() {
			if (attempt && attempt.data === Lampa.Player.playdata() && !attempt.pending) {
				attempt.started = true;
				clearTimeout(attempt.timer);
			}
		}
		listener.follow("loadeddata", onLoadedData);
		listener.follow("destroy", onVideoDestroy);
		var patchedSend = listener.send = function (event, error) {
			var data = Lampa.Player.playdata();
			if (event === "error" && error && error.fatal === false &&
				data && data.lamponline_stream) return this;
			if (event === "error" && error && error.fatal && retryHls()) return this;
			return send.apply(this, arguments);
		};
		restorePlayerBuffer = function () {
			clearTimeout(armTimer);
			clearAttempt();
			if (patchedLoadSource && prototype.loadSource === patchedLoadSource) prototype.loadSource = loadSource;
			listener.remove("loadeddata", onLoadedData);
			listener.remove("destroy", onVideoDestroy);
			if (listener.send === patchedSend) listener.send = send;
			restorePlayerBuffer = null;
		};
	}

	function startPlugin() {
		if (window.lamponline_plugin) return;
		initClearProtection();
		var rch = ensureRchNws();
		if (rch) rch.typeInvoke(Config.Urls.getLampOnline(), function () {});
		initPlayerBuffer();
		Lampa.Player.listener.follow("start", initPlayerBuffer);
		Lampa.Player.listener.follow("destroy", function () {
			if (restorePlayerBuffer) restorePlayerBuffer();
		});
		Lampa.Select.listener.follow("preshow", function (event) {
			var active = Lampa.Activity.active();
			if (active && active.component === "lamponline") event.active.nomark = true;
		});
		window.lamponline_plugin = true;
		var manifst = {
			type: "video",
			version: "1.0.0",
			name: "",
			description: "Просмотр онлайна",
			component: "lamponline",

			onContextLauch: function onContextLauch(object) {
				Lampa.Component.add("lamponline", component);

				var id = clarificationSearchKey(object);
				var all = getClarificationSearch();

				Lampa.Activity.push({
					url: "",
					title: Lampa.Lang.translate("title_online"),
					component: "lamponline",
					search: all[id] ? all[id] : object.title,
					search_one: object.title,
					search_two: object.original_title,
					movie: object,
					page: 1,
					clarification: all[id] ? true : false
				});
			}
		};
		addSourceSearch("Онлайн", "spider");

		Lampa.Manifest.plugins = manifst;
		Lampa.Lang.add({
			lampac_watch: {
				ru: "Смотреть онлайн",
				en: "Watch online",
				uk: "Дивитися онлайн",
				zh: "在线观看"
			},
			lampac_video: {
				ru: "Видео",
				en: "Video",
				uk: "Відео",
				zh: "视频"
			},
			lampac_no_watch_history: {
				ru: "Нет истории просмотра",
				en: "No browsing history",
				ua: "Немає історії перегляду",
				zh: "没有浏览历史"
			},
			lampac_nolink: {
				ru: "Не удалось извлечь ссылку",
				uk: "Неможливо отримати посилання",
				en: "Failed to fetch link",
				zh: "获取链接失败"
			},
			lampac_balanser: {
				ru: "Источник",
				uk: "Джерело",
				en: "Source",
				zh: "来源"
			},
			helper_online_file: {
				ru: 'Удерживайте клавишу "ОК" для вызова контекстного меню',
				uk: 'Утримуйте клавішу "ОК" для виклику контекстного меню',
				en: 'Hold the "OK" key to bring up the context menu',
				zh: "按住“确定”键调出上下文菜单"
			},
			title_online: {
				ru: "Онлайн",
				uk: "Онлайн",
				en: "Online",
				zh: "在线的"
			},
			lampac_voice_subscribe: {
				ru: "Подписаться на перевод",
				uk: "Підписатися на переклад",
				en: "Subscribe to translation",
				zh: "订阅翻译"
			},
			lampac_voice_success: {
				ru: "Вы успешно подписались",
				uk: "Ви успішно підписалися",
				en: "You have successfully subscribed",
				zh: "您已成功订阅"
			},
			lampac_voice_error: {
				ru: "Возникла ошибка",
				uk: "Виникла помилка",
				en: "An error has occurred",
				zh: "发生了错误"
			},
			lampac_clear_all_marks: {
				ru: "Очистить все метки",
				uk: "Очистити всі мітки",
				en: "Clear all labels",
				zh: "清除所有标签"
			},
			lampac_clear_all_timecodes: {
				ru: "Очистить все тайм-коды",
				uk: "Очистити всі тайм-коди",
				en: "Clear all timecodes",
				zh: "清除所有时间代码"
			},
			lampac_change_balanser: {
				ru: "Изменить балансер",
				uk: "Змінити балансер",
				en: "Change balancer",
				zh: "更改平衡器"
			},
			lampac_balanser_dont_work: {
				ru: "Поиск не дал результатов",
				uk: "Пошук на ({balanser}) не дав результатів",
				en: "Search on ({balanser}) did not return any results",
				zh: "搜索 ({balanser}) 未返回任何结果"
			},
			lampac_balanser_timeout: {
				ru: 'Источник будет переключен автоматически через <span class="timeout">10</span> секунд.',
				uk: 'Джерело буде автоматично переключено через <span class="timeout">10</span> секунд.',
				en: 'The source will be switched automatically after <span class="timeout">10</span> seconds.',
				zh: '平衡器将在<span class="timeout">10</span>秒内自动切换。'
			},
			lampac_does_not_answer_text: {
				ru: "Поиск не дал результатов",
				uk: "Пошук на ({balanser}) не дав результатів",
				en: "Search on ({balanser}) did not return any results",
				zh: "搜索 ({balanser}) 未返回任何结果"
			},
			lampac_server_not_set: {
				ru: "Сервер не настроен",
				uk: "Сервер не налаштований",
				en: "Server not configured",
				zh: "服务器未配置"
			},
			lampac_server_not_set_desc: {
				ru: "Укажите адрес сервера в настройках для просмотра онлайн",
				uk: "Вкажіть адресу сервера в налаштуваннях для перегляду онлайн",
				en: "Specify the server address in settings to watch online",
				zh: "在设置中指定服务器地址以在线观看"
			},
			lampac_server_unavailable: {
				ru: "Сервер не отвечает",
				uk: "Сервер не відповідає",
				en: "Server is unavailable",
				zh: "服务器无响应"
			},
			lampac_server_unavailable_desc: {
				ru: "Выберите другой сервер или HDRezka в списке балансеров.",
				uk: "Виберіть інший сервер або HDRezka у списку балансерів.",
				en: "Choose another server or HDRezka from the balancer list.",
				zh: "请在平衡器列表中选择其他服务器或 HDRezka。"
			},
			lampac_setup_title: {
				ru: "Настройте просмотр онлайн",
				uk: "Налаштуйте перегляд онлайн",
				en: "Set up online viewing",
				zh: "设置在线观看"
			},
			lampac_setup_desc: {
				ru: "Чтобы начать просмотр, добавьте сервер или войдите в аккаунт HDRezka в настройках «Онлайн».",
				uk: "Щоб почати перегляд, додайте сервер або увійдіть в акаунт HDRezka в налаштуваннях «Онлайн».",
				en: "To start watching, add a server or sign in to HDRezka in Online settings.",
				zh: "请在在线设置中添加服务器或登录 HDRezka 以开始观看。"
			},
			lampac_rezka_login_title: {
				ru: "Войдите в HDRezka",
				uk: "Увійдіть у HDRezka",
				en: "Sign in to HDRezka",
				zh: "登录 HDRezka"
			},
			lampac_rezka_login_desc: {
				ru: "Для просмотра откройте настройки HDRezka и войдите в аккаунт.",
				uk: "Для перегляду відкрийте налаштування HDRezka та увійдіть в акаунт.",
				en: "Open HDRezka settings and sign in to watch.",
				zh: "打开 HDRezka 设置并登录后即可观看。"
			},
			lampac_open_settings: {
				ru: "Открыть настройки",
				uk: "Відкрити налаштування",
				en: "Open settings",
				zh: "打开设置"
			},
			lampac_enter_server: {
				ru: "Ввести адрес сервера",
				uk: "Ввести адресу сервера",
				en: "Enter server address",
				zh: "输入服务器地址"
			},
			lampac_server_short: {
				ru: "Сервер",
				uk: "Сервер",
				en: "Server",
				zh: "服务器"
			},
			lampac_not_set: {
				ru: "Не указан",
				uk: "Не вказано",
				en: "Not set",
				zh: "未设置"
			},
			lampac_add_server: {
				ru: "Добавить сервер",
				uk: "Додати сервер",
				en: "Add server",
				zh: "添加服务器"
			},
			lampac_select_server: {
				ru: "Выбор сервера",
				uk: "Вибір сервера",
				en: "Select server",
				zh: "选择服务器"
			},
			lampac_servers_list: {
				ru: "Список серверов",
				uk: "Список серверів",
				en: "Servers list",
				zh: "服务器列表"
			},
			lampac_select_this: {
				ru: "Выбрать",
				uk: "Вибрати",
				en: "Select",
				zh: "选择"
			},
			lampac_delete_server: {
				ru: "Удалить",
				uk: "Видалити",
				en: "Delete",
				zh: "删除"
			},
			lampac_edit_server: {
				ru: "Редактировать",
				uk: "Редагувати",
				en: "Edit",
				zh: "编辑"
			},
			lampac_server_address: {
				ru: "Адрес сервера",
				uk: "Адреса сервера",
				en: "Server address",
				zh: "服务器地址"
			},
			lampac_server_address_desc: {
				ru: "Например: 192.168.1.1:9118, lampac.site",
				uk: "Наприклад: 192.168.1.1:9118, lampac.site",
				en: "Example: 192.168.1.1:9118, lampac.site",
				zh: "例如：192.168.1.1:9118, lampac.site"
			},
			lampac_settings_title: {
				ru: "Онлайн",
				uk: "Онлайн",
				en: "Online",
				zh: "在线"
			}
		});

		var button =
			'<div class="full-start__button selector view--online lampac--button" data-subtitle="'.concat(
				manifst.name,
				' ',
				manifst.version,
				'">\n         <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">\n<path d="M11.783 10.094c-1.699.998-3.766 1.684-5.678 1.95a1.66 1.66 0 0 1-.684.934c.512 1.093 1.249 2.087 2.139 2.987a7.98 7.98 0 0 0 6.702-3.074l.083-.119c-.244-.914-.648-1.784-1.145-2.644q-.134.038-.261.062c-.143.04-.291.068-.446.068a1.7 1.7 0 0 1-.71-.164M9.051 5.492a18 18 0 0 0-2.004-1.256 1.67 1.67 0 0 1-1.907.985c-.407 1.535-.624 3.162-.511 4.694a1.67 1.67 0 0 1 1.52 1.354c1.695-.279 3.47-.879 4.967-1.738a1.67 1.67 0 0 1-.297-.949c0-.413.156-.786.403-1.078-.654-.736-1.389-1.443-2.171-2.012M4 9.989c-.137-1.634.104-3.392.541-5.032a1.67 1.67 0 0 1-.713-1.369c0-.197.039-.386.104-.562a18 18 0 0 0-1.974-.247c-.089.104-.185.204-.269.314a7.98 7.98 0 0 0-1.23 7.547 9.5 9.5 0 0 0 2.397.666A1.67 1.67 0 0 1 4 9.989m9.928-.3c-.029.037-.064.067-.096.1.433.736.799 1.482 1.053 2.268a7.98 7.98 0 0 0 .832-6.122c-.09.133-.176.267-.271.396-.436.601-.875 1.217-1.354 1.772.045.152.076.311.076.479v.004c.084.374.013.779-.24 1.103M7.164 3.447c.799.414 1.584.898 2.33 1.44.84.611 1.627 1.373 2.324 2.164.207-.092.434-.145.676-.145.5 0 .945.225 1.252.572.404-.492.783-1.022 1.161-1.54.194-.268.372-.543.544-.82A7.96 7.96 0 0 0 7.701.012q-.173.217-.339.439c-.401.552-.739 1.08-1.04 1.637.039.029.064.066.1.1.417.276.697.734.742 1.259m-4.285 8.518a10 10 0 0 1-2.07-.487 7.95 7.95 0 0 0 5.806 4.397 11 11 0 0 1-1.753-2.66 1.675 1.675 0 0 1-1.983-1.25m1.635-9.723a1.32 1.32 0 0 1 1.199-.416C6.025 1.24 6.377.683 6.794.104a7.97 7.97 0 0 0-4.247 2.062c.59.066 1.176.14 1.761.252q.096-.095.206-.176" fill="currentColor"/>\n</svg>\n\n        <span>#{title_online}</span>\n    </div>'
			);

		Lampa.Component.add("lamponline", component);

		function addButton(e) {
			if (e.render.siblings(".lampac--button").length) return;
			var btn = $(Lampa.Lang.translate(button));
			btn.on("hover:enter", function () {
				Lampa.Component.add("lamponline", component);

				var id = clarificationSearchKey(e.movie);
				var all = getClarificationSearch();

				Lampa.Activity.push({
					url: "",
					title: Lampa.Lang.translate("title_online"),
					component: "lamponline",
					search: all[id] ? all[id] : e.movie.title,
					search_one: e.movie.title,
					search_two: e.movie.original_title,
					movie: e.movie,
					page: 1,
					clarification: all[id] ? true : false
				});
			});
			e.render.before(btn);
		}
		Lampa.Listener.follow("full", function (e) {
			if (e.type == "complite") {
				addButton({
					render: e.object.activity.render().find(".view--torrent"),
					movie: e.data.movie
				});
			}
		});
		try {
			if (Lampa.Activity.active().component == "full") {
				addButton({
					render: Lampa.Activity.active()
						.activity.render()
						.find(".view--torrent"),
					movie: Lampa.Activity.active().card
				});
			}
		} catch (e) {
			console.error(e);
		}
		if (Lampa.Manifest.app_digital >= 177) {
			var balansers_sync = [
				"filmix",
				"filmixtv",
				"fxapi",
				"rezka",
				"rhsprem",
				"lumex",
				"videodb",
				"collaps",
				"collaps-dash",
				"hdvb",
				"zetflix",
				"kodik",
				"ashdi",
				"kinoukr",
				"kinotochka",
				"remux",
				"iframevideo",
				"cdnmovies",
				"anilibria",
				"animedia",
				"animego",
				"animevost",
				"animebesst",
				"redheadsound",
				"alloha",
				"animelib",
				"moonanime",
				"kinopub",
				"vibix",
				"vdbmovies",
				"fancdn",
				"cdnvideohub",
				"vokino",
				"rc/filmix",
				"rc/fxapi",
				"rc/rhs",
				"vcdn",
				"videocdn",
				"mirage",
				"hydraflix",
				"videasy",
				"vidsrc",
				"movpi",
				"vidlink",
				"twoembed",
				"autoembed",
				"smashystream",
				"autoembed",
				"rgshows",
				"pidtor",
				"videoseed",
				"iptvonline",
				"veoveo"
			];
			balansers_sync.forEach(function (name) {
				Lampa.Storage.sync(
					Config.StorageKeys.OnlineChoicePrefix + name,
					"object_object"
				);
			});
			Lampa.Storage.sync(Config.StorageKeys.OnlineWatchedLast, "object_object");
		}

		Lampa.SettingsApi.addComponent({
			component: "lamponline_settings",
			name: Lampa.Lang.translate("lampac_settings_title"),
			icon: '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M11.783 10.094c-1.699.998-3.766 1.684-5.678 1.95a1.66 1.66 0 0 1-.684.934c.512 1.093 1.249 2.087 2.139 2.987a7.98 7.98 0 0 0 6.702-3.074l.083-.119c-.244-.914-.648-1.784-1.145-2.644q-.134.038-.261.062c-.143.04-.291.068-.446.068a1.7 1.7 0 0 1-.71-.164M9.051 5.492a18 18 0 0 0-2.004-1.256 1.67 1.67 0 0 1-1.907.985c-.407 1.535-.624 3.162-.511 4.694a1.67 1.67 0 0 1 1.52 1.354c1.695-.279 3.47-.879 4.967-1.738a1.67 1.67 0 0 1-.297-.949c0-.413.156-.786.403-1.078-.654-.736-1.389-1.443-2.171-2.012M4 9.989c-.137-1.634.104-3.392.541-5.032a1.67 1.67 0 0 1-.713-1.369c0-.197.039-.386.104-.562a18 18 0 0 0-1.974-.247c-.089.104-.185.204-.269.314a7.98 7.98 0 0 0-1.23 7.547 9.5 9.5 0 0 0 2.397.666A1.67 1.67 0 0 1 4 9.989m9.928-.3c-.029.037-.064.067-.096.1.433.736.799 1.482 1.053 2.268a7.98 7.98 0 0 0 .832-6.122c-.09.133-.176.267-.271.396-.436.601-.875 1.217-1.354 1.772.045.152.076.311.076.479v.004c.084.374.013.779-.24 1.103M7.164 3.447c.799.414 1.584.898 2.33 1.44.84.611 1.627 1.373 2.324 2.164.207-.092.434-.145.676-.145.5 0 .945.225 1.252.572.404-.492.783-1.022 1.161-1.54.194-.268.372-.543.544-.82A7.96 7.96 0 0 0 7.701.012q-.173.217-.339.439c-.401.552-.739 1.08-1.04 1.637.039.029.064.066.1.1.417.276.697.734.742 1.259m-4.285 8.518a10 10 0 0 1-2.07-.487 7.95 7.95 0 0 0 5.806 4.397 11 11 0 0 1-1.753-2.66 1.675 1.675 0 0 1-1.983-1.25m1.635-9.723a1.32 1.32 0 0 1 1.199-.416C6.025 1.24 6.377.683 6.794.104a7.97 7.97 0 0 0-4.247 2.062c.59.066 1.176.14 1.761.252q.096-.095.206-.176" fill="currentColor"/></svg>'
		});

		Lampa.Params.select(STORAGE_KEY_SERVER, "", "");
		initRezkaSettings();

		Lampa.SettingsApi.addParam({
			component: "lamponline_settings",
			param: {
				name: "lamponline_add_server_btn",
				type: "static"
			},
			field: {
				name: Lampa.Lang.translate("lampac_add_server"),
				description: Lampa.Lang.translate("lampac_server_address_desc")
			},
			onRender: function (item) {
				item.attr("data-name", "lamponline_add_server_btn");
				item.on("hover:enter", function () {
					Lampa.Input.edit(
						{
							title: Lampa.Lang.translate("lampac_server_address"),
							value: "",
							placeholder: "192.168.1.1:9118",
							nosave: true,
							free: true,
							nomic: true
						},
						function (new_value) {
							if (isBwaServer(new_value) && !validBwaKey(getBwaKey()))
								return openBwaInput(function () { Lampa.Settings.update(); });
							if (new_value && addServer(new_value)) {
								var servers = getServersList();
								setActiveServerIndex(servers.length - 1);
								ensureRchNws();
								Lampa.Settings.update();
							}
						}
					);
				});
			}
		});

		initBwaSettings();

		Lampa.SettingsApi.addParam({
			component: "lamponline_settings",
			param: {
				name: "lamponline_servers_title",
				type: "title"
			},
			field: {
				name: Lampa.Lang.translate("lampac_servers_list")
			}
		});

		Lampa.Settings.listener.follow("open", function (event) {
			if (event.name == "lamponline_settings") {
				renderServersList(event.body);
			}
		});
	}

	function renderServersList(body) {
		body.find(".lamponline-server-item").remove();

		var servers = getServersList();
		var activeIndex = getActiveServerIndex();
		var titleElem = body.find(".settings-param-title").last();

		if (!titleElem.length) {
			titleElem = body.find(".settings-param").last();
		}

		servers.forEach(function (server, index) {
			var displayName = formatServerDisplay(server);
			var isActive = index === activeIndex;
			var hasToken = !!getServerToken(server);
			var hasUid = !!getServerUid(server);
			var statusParts = [];
			if (isActive) statusParts.push("Текущий сервер");
			if (hasToken) statusParts.push("Токен установлен");
			if (hasUid) statusParts.push("UID: " + getServerUid(server));
			if (isBwaServer(server)) statusParts.push(getBwaKey() ? "Ключ BWA сохранён" : "Ключ BWA не задан");
			var statusText = statusParts.join(" • ");
			var item = $(
				'<div class="settings-param selector lamponline-server-item" data-server-index="' +
					index +
					'">' +
					'<div class="settings-param__name"></div>' +
					'<div class="settings-param__value"></div>' +
					(statusText
						? '<div class="settings-param__descr"></div>'
						: "") +
					"</div>"
			);

			item.find(".settings-param__name").text(displayName);
			item.find(".settings-param__descr").text(statusText);

			item.on("hover:enter", function () {
				showServerActions(index, displayName, function () {
					renderServersList(body);
				});
			});

			titleElem.after(item);
			titleElem = item;
		});

		if (servers.length === 0) {
			var emptyItem = $(
				'<div class="settings-param lamponline-server-item">' +
					'<div class="settings-param__name" style="opacity: 0.5">' +
					Lampa.Lang.translate("lampac_not_set") +
					"</div>" +
					"</div>"
			);
			titleElem.after(emptyItem);
		}

		body.find(".lamponline-server-item").on("hover:focus", function () {
			Lampa.Params.listener.send("update_scroll_position");
		});

		Lampa.Params.listener.send("update_scroll");
	}

	function editServer(index, newUrl) {
		newUrl = normalizeServerInput(newUrl);
		var previous = getServerUrl();
		var servers = getServersList();
		if (typeof index === "number" && index % 1 === 0 && index >= 0 && index < servers.length &&
			typeof newUrl === "string" && newUrl.trim()) {
			if (servers.some(function (server, serverIndex) {
				return serverIndex !== index && normalizeServerInput(server) === newUrl;
			})) return false;
			var oldUrl = servers[index];
			if (oldUrl === newUrl) return true;
			var token = getServerToken(oldUrl);
			var uid = getServerUid(oldUrl);
			if (token) {
				setServerToken(newUrl, token);
				setServerToken(oldUrl, "");
			}
			if (uid) {
				setServerUid(newUrl, uid);
				setServerUid(oldUrl, "");
			}
			servers[index] = newUrl;
			persistentSet(STORAGE_KEY_SERVERS, servers);
			var oldServer = persistentGet(STORAGE_KEY_SERVER, "");
			if (oldServer === oldUrl) {
				persistentSet(STORAGE_KEY_SERVER, newUrl);
			}
			ServerManager.changed(previous);
			return true;
		}
		return false;
	}

	function showServerActions(index, serverName, callback, showTokenMenu) {
		var servers = getServersList();
		var activeIndex = getActiveServerIndex();
		var isActive = index === activeIndex;
		var serverUrl = servers[index];
		var currentToken = getServerToken(serverUrl);
		var currentUid = getServerUid(serverUrl);

		var items = [];

		if (!isActive) {
			items.push({
				title: Lampa.Lang.translate("lampac_select_this"),
				select: true
			});
		}
		if (isBwaServer(serverUrl)) {
			items.push({title: getBwaKey() ? "Изменить ключ BWA" : "Добавить ключ BWA", bwa: true});
			if (getBwaKey()) items.push({title: "Удалить ключ BWA", removeBwaKey: true});
		}
		if (showTokenMenu) {
			items.push({
				title: currentToken ? "Изменить токен" : "Добавить токен",
				token: true
			});
			if (currentToken)
				items.push({ title: "Удалить токен", removeToken: true });

			items.push({
				title: currentUid ? "Изменить UID" : "Добавить UID",
				uid: true
			});
			if (currentUid) items.push({ title: "Удалить UID", removeUid: true });
		}
		items.push({
			title: Lampa.Lang.translate("lampac_edit_server"),
			edit: true
		});

		items.push({
			title: Lampa.Lang.translate("lampac_delete_server"),
			remove: true
		});

		var enabled = Lampa.Controller.enabled().name;

		function finish() {
			if (callback) callback();
			Lampa.Controller.toggle(enabled);
			var body = Lampa.Settings.render().find(".settings__body");
			var items = body.find(".lamponline-server-item.selector");
			var focus = items.length ? items.eq(Math.min(index, items.length - 1))
				: body.find('[data-name="lamponline_add_server_btn"]');
			if (focus.length) {
				Lampa.Controller.collectionSet(body);
				Lampa.Controller.collectionFocus(focus[0], body);
			}
		}

		Lampa.Select.show({
			title: safeUiText(serverName),
			items: items,
			onBack: function () {
				Lampa.Controller.toggle(enabled);
			},
			onSelect: function (item) {
				if (item.select) {
					setActiveServerIndex(index);
					ensureRchNws();
					finish();
				} else if (item.bwa) {
					Lampa.Select.close();
					openBwaInput(finish);
				} else if (item.removeBwaKey) {
					setBwaKey("");
					Lampa.Noty.show("Ключ BWA удалён с устройства.");
					finish();
				} else if (item.token) {
					Lampa.Select.close();
					Lampa.Input.edit(
						{
							title: "Токен сервера",
							value: currentToken,
							nosave: true,
							free: true,
							nomic: true
						},
						function (new_value) {
							if (new_value !== null) {
								setServerToken(serverUrl, new_value.trim());
								if (new_value.trim()) {
									Lampa.Noty.show("Токен сохранён");
								}
							}
							finish();
						}
					);
				} else if (item.removeToken) {
					setServerToken(serverUrl, "");
					Lampa.Noty.show("Токен удалён");
					finish();
				} else if (item.uid) {
					Lampa.Select.close();
					Lampa.Input.edit(
						{
							title: "UID для сервера",
							value: currentUid,
							placeholder: "guest",
							nosave: true,
							free: true,
							nomic: true
						},
						function (new_value) {
							if (new_value !== null) {
								setServerUid(serverUrl, new_value.trim());
								if (new_value.trim()) {
									Lampa.Noty.show("UID сохранён");
								}
							}
							finish();
						}
					);
				} else if (item.removeUid) {
					setServerUid(serverUrl, "");
					Lampa.Noty.show("UID удалён");
					finish();
				} else if (item.edit) {
					Lampa.Select.close();
					Lampa.Input.edit(
						{
							title: Lampa.Lang.translate("lampac_server_address"),
							value: servers[index],
							placeholder: "192.168.1.1:9118",
							nosave: true,
							free: true,
							nomic: true
						},
						function (new_value) {
							if (new_value && new_value !== servers[index]) {
								editServer(index, new_value);
								ensureRchNws();
							}
							finish();
						}
					);
				} else if (item.remove) {
					removeServer(index);
					finish();
				}
			},
			onLong: function (item) {
				if (item.edit) {
					Lampa.Select.close();
					showServerActions(index, serverName, callback, true);
				}
			}
		});
	}

	function openServerInput(callback) {
		var activity = Lampa.Activity.active();
		var enabled = Lampa.Controller.enabled().name;
		Lampa.Input.edit(
			{
				title: Lampa.Lang.translate("lampac_server_address"),
				value: "",
				placeholder: "192.168.1.1:9118",
				nosave: true,
				free: true,
				nomic: true
			},
			function (new_value) {
				if (new_value) {
					if (isBwaServer(new_value) && !validBwaKey(getBwaKey())) return openBwaInput(function () {
						if (callback) callback(BWA_SERVER);
					});
					new_value = normalizeServerInput(new_value);
					addServer(new_value);
					var servers = getServersList();
					setActiveServerIndex(servers.findIndex(function (server) { return normalizeServerInput(server) === new_value; }));
					ensureRchNws();
				}
				if (Lampa.Activity.active() !== activity) return;
				if (callback) callback(new_value);
				else Lampa.Controller.toggle(enabled);
			}
		);
	}

	function openServerSelect(callback, onBackOverride, context) {
		context = context || {
			activity: Lampa.Activity.active(),
			controller: Lampa.Controller.enabled().name
		};
		if (Lampa.Activity.active() !== context.activity) return;
		var servers = getServersList();
		var activeIndex = getActiveServerIndex();
		var items = [];

		function back() {
			if (Lampa.Activity.active() !== context.activity) return;
			if (onBackOverride) onBackOverride();
			else Lampa.Controller.toggle(context.controller);
		}

		function refresh() {
			if (Lampa.Activity.active() !== context.activity) return;
			if (callback) callback();
			openServerSelect(callback, onBackOverride, context);
		}

		servers.forEach(function (server, index) {
			items.push({
				title: safeUiText(formatServerDisplay(server)),
				index: index,
				selected: index === activeIndex
			});
		});

		items.push({
			title: Lampa.Lang.translate("lampac_add_server"),
			add: true
		});
		items.push({title: "Добавить сервер BWA", bwa: true});

		Lampa.Select.show({
			title: Lampa.Lang.translate("lampac_select_server"),
			items: items,
			onBack: back,
			onSelect: function (item) {
				if (item.bwa) {
					Lampa.Select.close();
					openBwaInput(refresh);
				} else if (item.add) {
					openServerInput(refresh);
				} else if (item.selected) {
					var displayName = formatServerDisplay(servers[item.index]);
					Lampa.Select.show({
						title: safeUiText(displayName),
						items: (isBwaServer(servers[item.index]) ? [{title: getBwaKey() ? "Изменить ключ BWA" : "Добавить ключ BWA", bwa: true}] : []).concat([
							{
								title: Lampa.Lang.translate("lampac_edit_server"),
								edit: true
							},
							{
								title: Lampa.Lang.translate("lampac_delete_server"),
								remove: true
							}
						]),
						onBack: function () {
							openServerSelect(callback, onBackOverride, context);
						},
						onSelect: function (a) {
							if (a.bwa) {
								Lampa.Select.close();
								openBwaInput(refresh);
							} else if (a.edit) {
								Lampa.Input.edit(
									{
										title: Lampa.Lang.translate("lampac_server_address"),
										value: servers[item.index],
										placeholder: "192.168.1.1:9118",
										nosave: true,
										free: true,
										nomic: true
									},
									function (new_value) {
										if (new_value && new_value !== servers[item.index]) {
											editServer(item.index, new_value);
											ensureRchNws();
										}
										refresh();
									}
								);
							} else if (a.remove) {
								removeServer(item.index);
								refresh();
							}
						}
					});
				} else {
					setActiveServerIndex(item.index);
					ensureRchNws();
					if (Lampa.Activity.active() !== context.activity) return;
					if (callback) callback();
					back();
				}
			}
		});
	}

	function openServerMenu(callback, onBackOverride) {
		openServerSelect(callback, onBackOverride);
	}

	if (window.appready) startPlugin();
	else Lampa.Listener.follow("app", function onReady(event) {
		if (event.type !== "ready") return;
		Lampa.Listener.remove("app", onReady);
		startPlugin();
	});

})();
