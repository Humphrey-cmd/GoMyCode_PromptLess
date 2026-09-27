// Show Sign Up Page

function showSignup() {
    document.getElementById("login-page").style.display = "none";
    document.getElementById("signup-page").style.display = "block";
}


// Show Login Page

function showLogin() {
    document.getElementById("signup-page").style.display = "none";
    document.getElementById("login-page").style.display = "block";
}


// Forgot Password

function forgotPassword() {
    const message = document.getElementById("forgotMessage");

    if (message.style.display === "block") {
        message.style.display = "none";
    } else {
        message.style.display = "block";
    }
}


// Check Passwords

document.getElementById("signupForm").addEventListener("submit", function(event) {

    const password =
        document.getElementById("signupPassword").value;

    const confirmPassword =
        document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {

        event.preventDefault();

        alert("Passwords do not match!");

    } else {

        alert("Account created successfully!");

    }

});


// Login

document.getElementById("loginForm").addEventListener("submit", function(event) {

    event.preventDefault();

    alert("Login submitted successfully!");

});