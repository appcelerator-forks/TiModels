var args 		= arguments[0] || {};

var App 		= require('core');
var moment 		= require('alloy/moment');
var session 	= Alloy.Models.instance('session');
var userModel 	= Alloy.Models.instance('user');

$.loginButton.addEventListener('click', loginEvent);

$.open = function(){
	$.window.open();
};
$.close = function(){
	$.window.close();
};

function init () {
	
};
function loginEvent(){
	userModel.login({
		username : $.usernameField.value,
		password : $.passwordField.value,
		success : handleLoginSuccess,
		failure : handleLoginFailure
	});
};
function handleLoginSuccess (_response) {
	$.stayLoggedInSwitch.value && session.start();
};
function handleLoginFailure (_response) {
	if (_response.code === userModel.ERROR_NO_USER){
		userModel.createNew({
			username : $.usernameField.value,
			password : $.passwordField.value
		});

	} else {
		$.passwordField.value = '';
		$.usernameField.focus();

		alert('Wrong username and password');
	}

};

init();