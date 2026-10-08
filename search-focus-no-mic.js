(function () {
	"use strict";

	function injectStyles() {
		var style = document.createElement("style");
		style.textContent =
			".simple-keyboard-mic{pointer-events:none!important;color:#fff!important}.simple-keyboard-mic.focus{background:transparent!important;box-shadow:none!important;outline:none!important}";
		document.head.appendChild(style);
	}

	function handleSearch() {
		var keyboard = document.querySelector(".simple-keyboard");
		if (!keyboard) return;

		var mic = keyboard.querySelector(".simple-keyboard-mic");
		var input = keyboard.querySelector(".simple-keyboard-input");
		var updateCollection = mic && mic.classList.contains("selector");

		if (mic) {
			mic.classList.remove("selector");
			mic.removeAttribute("tabindex");
		}

		if (input && (updateCollection || document.activeElement !== input)) {
			if (updateCollection) Lampa.Controller.collectionSet(keyboard);
			Lampa.Controller.collectionFocus(input, keyboard);
		}
	}

	function start() {
		injectStyles();
		Lampa.Controller.listener.follow("toggle", function (e) {
			if (e.name === "search" || e.name === "keybord") {
				handleSearch();
			}
		});
	}

	function onReady(e) {
		if (e.type === "ready") {
			Lampa.Listener.remove("app", onReady);
			start();
		}
	}

	function init() {
		if (typeof Lampa === "undefined" || !Lampa.Listener) {
			setTimeout(init, 500);
		} else if (window.appready) {
			start();
		} else {
			Lampa.Listener.follow("app", onReady);
		}
	}

	init();
})();
