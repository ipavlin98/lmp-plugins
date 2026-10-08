(function () {
	"use strict";

	var initialized = false;
	var pipActive = false;
	var isEnteringPiP = false;
	var pipContainer = null;
	var originalVideo = null;
	var originalVideoParent = null;
	var originalVideoSibling = null;
	var originalVideoStyle = null;
	var playerContainer = null;
	var playerParent = null;
	var playerSibling = null;
	var pipActivatedTime = 0;

	function createPipContainer() {
		if (pipContainer) return;

		pipContainer = document.createElement("div");
		pipContainer.id = "lampa-pip-container";
		pipContainer.innerHTML = '<div class="lampa-pip-video-wrap"></div>';
		document.body.appendChild(pipContainer);

		pipContainer.addEventListener("click", function (e) {
			if (Date.now() - pipActivatedTime < 500) return;
			e.stopPropagation();
			exitPiP();
		});
	}

	function createHeaderButton() {
		var existing = document.querySelector(".head__action.pip--icon");
		if (existing) return;

		var actions = document.querySelector(".head__actions");
		if (!actions) return;

		var btn = document.createElement("div");
		btn.className = "head__action selector pip--icon";
		btn.style.display = "none";
		btn.innerHTML =
			'<svg viewBox="0 0 24.5 23.2" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.1,0h-3.7h-1.5H5.3C2.4,0,0,2.4,0,5.4v12.5c0,3,2.4,5.3,5.4,5.3h13.8c3,0,5.3-2.4,5.3-5.3V9.9V8.5V5.4C24.5,2.4,22.1,0,19.1,0z M19.1,20.5h-13H5.3c-1.5,0-2.6-1.2-2.6-2.7V5.4c0-1.5,1.2-2.6,2.6-2.6h5.1c-0.1,0.2-0.1,0.5-0.1,0.7v6.5c0,1.9,1.5,3.4,3.4,3.4H21c0.3,0,0.5,0,0.7-0.1v4.5C21.8,19.3,20.6,20.5,19.1,20.5z M21.8,9.9c0,0.4-0.3,0.7-0.7,0.7h-7.2c-0.4,0-0.7-0.3-0.7-0.7V3.4c0-0.4,0.3-0.7,0.7-0.7h1.5h3.7c1.5,0,2.7,1.2,2.7,2.6v3.2V9.9z" fill="currentColor"/></svg>';

		actions.insertBefore(btn, actions.firstChild);

		btn.addEventListener("click", function (e) {
			e.stopPropagation();
			exitPiP();
		});

		$(btn).on("hover:enter", function () {
			exitPiP();
		});
	}

	function showHeaderButton() {
		var btn = document.querySelector(".head__action.pip--icon");
		if (btn) btn.style.display = "";
	}

	function hideHeaderButton() {
		var btn = document.querySelector(".head__action.pip--icon");
		if (btn) btn.style.display = "none";
	}

	function togglePiP() {
		if (pipActive) {
			exitPiP();
		} else {
			enterPiP();
		}
	}

	function updatePipSize() {
		if (!pipActive || !pipContainer || !originalVideo) return;

		var aspectRatio = (originalVideo.videoWidth || 16) / (originalVideo.videoHeight || 9);
		var width = Math.min(512, window.innerWidth - 32, (window.innerHeight - 32) * aspectRatio);

		pipContainer.style.width = Math.max(1, width) + "px";
		pipContainer.style.height = Math.max(1, Math.round(width / aspectRatio)) + "px";
	}

	function enterPiP() {
		if (pipActive || isEnteringPiP) return;

		var video = document.querySelector(".player-video__display video") || document.querySelector(".player video");
		var player = document.querySelector(".player");
		if (!video || !player) {
			Lampa.Noty.show("PiP доступен только со встроенным плеером. Измените плеер в настройках.");
			return;
		}

		createPipContainer();
		createHeaderButton();

		isEnteringPiP = true;
		originalVideo = video;
		originalVideoParent = video.parentNode;
		originalVideoSibling = video.nextSibling;
		originalVideoStyle = video.getAttribute("style");
		playerContainer = player;
		playerParent = player.parentNode;
		playerSibling = player.nextSibling;
		pipActive = true;
		pipActivatedTime = Date.now();

		pipContainer.classList.add("active");
		pipContainer.querySelector(".lampa-pip-video-wrap").appendChild(video);
		video.style.cssText = "width:100%!important;height:100%!important;object-fit:contain!important;position:static!important;transform:none!important;";
		video.addEventListener("loadedmetadata", updatePipSize);
		video.addEventListener("resize", updatePipSize);
		window.addEventListener("resize", updatePipSize);
		updatePipSize();

		Lampa.PlayerPanel.hide();
		playerParent.removeChild(player);
		document.body.classList.add("lampa-pip-mode");
		document.body.classList.remove("player--viewing");
		showHeaderButton();

		try {
			Lampa.Controller.toggle("content");
		} finally {
			isEnteringPiP = false;
		}
	}

	function leavePiP() {
		if (!pipActive) return;

		originalVideo.removeEventListener("loadedmetadata", updatePipSize);
		originalVideo.removeEventListener("resize", updatePipSize);
		window.removeEventListener("resize", updatePipSize);

		var parent = playerParent && document.documentElement.contains(playerParent) ? playerParent : document.body;
		parent.insertBefore(playerContainer, playerSibling && playerSibling.parentNode === parent ? playerSibling : null);
		originalVideoParent.insertBefore(originalVideo, originalVideoSibling && originalVideoSibling.parentNode === originalVideoParent ? originalVideoSibling : null);
		if (originalVideoStyle === null) originalVideo.removeAttribute("style");
		else originalVideo.setAttribute("style", originalVideoStyle);

		pipContainer.classList.remove("active");
		document.body.classList.remove("lampa-pip-mode");
		document.body.classList.add("player--viewing");
		hideHeaderButton();
		pipActive = false;
		originalVideo = null;
		originalVideoParent = null;
		originalVideoSibling = null;
		originalVideoStyle = null;
		playerContainer = null;
		playerParent = null;
		playerSibling = null;
	}

	function exitPiP() {
		if (!pipActive) return;

		leavePiP();
		Lampa.Controller.toggle("player");
		Lampa.PlayerPanel.show();
	}

	function addStyles() {
		var css = [
			"#lampa-pip-container {",
			"  display: none;",
			"  position: fixed;",
			"  width: 400px;",
			"  height: 225px;",
			"  right: 16px;",
			"  bottom: 16px;",
			"  z-index: 999999;",
			"  border-radius: 10px;",
			"  overflow: hidden;",
			"  box-shadow: 0 5px 30px rgba(0,0,0,0.7);",
			"  background: #000;",
			"  cursor: pointer;",
			"  transition: width 0.2s, height 0.2s;",
			"  -webkit-transform: translateZ(0);",
			"  transform: translateZ(0);",
			"  -webkit-mask-image: -webkit-radial-gradient(white, black);",
			"}",
			"#lampa-pip-container.active {",
			"  display: block;",
			"}",
			".lampa-pip-video-wrap {",
			"  width: 100%;",
			"  height: 100%;",
			"  overflow: hidden;",
			"  border-radius: 10px;",
			"  -webkit-transform: translateZ(0);",
			"  transform: translateZ(0);",
			"  -webkit-mask-image: -webkit-radial-gradient(white, black);",
			"}",
			".lampa-pip-video-wrap video {",
			"  width: 100% !important;",
			"  height: 100% !important;",
			"  object-fit: contain !important;",
			"  transform: none !important;",
			"  border-radius: 10px;",
			"}",
			"body.lampa-pip-mode .activity--active {",
			"  opacity: 1 !important;",
			"}",
			".player-panel__pip.hide {",
			"  display: flex !important;",
			"}"
		].join("\n");

		var style = document.createElement("style");
		style.id = "lampa-pip-styles";
		style.textContent = css;
		document.head.appendChild(style);
	}

	function initPlugin() {
		if (initialized || document.getElementById("lampa-pip-styles")) return;
		initialized = true;

		addStyles();
		Lampa.PlayerVideo.pip = togglePiP;

		var originalDestroy = Lampa.PlayerVideo.destroy;
		Lampa.PlayerVideo.destroy = function () {
			exitPiP();
			return originalDestroy.apply(this, arguments);
		};

		var originalClose = Lampa.Player.close;
		Lampa.Player.close = function () {
			if (isEnteringPiP) return;
			leavePiP();
			return originalClose.apply(this, arguments);
		};

		["play", "iptv"].forEach(function (name) {
			var original = Lampa.Player[name];
			if (!original) return;
			Lampa.Player[name] = function () {
				if (pipActive) {
					Lampa.Noty.show("Сначала разверните PiP");
					return;
				}
				return original.apply(this, arguments);
			};
		});
	}

	if (window.appready) {
		initPlugin();
	} else {
		Lampa.Listener.follow("app", function (e) {
			if (e.type === "ready") initPlugin();
		});
	}
})();
