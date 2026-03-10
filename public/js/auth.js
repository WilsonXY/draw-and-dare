$(document).ready(function() {
    
    // Handle Login Form Submission
    $('#login-form').on('submit', function(e) {
        e.preventDefault(); // Prevent default HTML form submission

        const data = {
            username: $('#username').val(),
            password: $('#password').val()
        };

        $.ajax({
            url: '/api/login',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data),
            success: function(response) {
                if (response.success) {
                    // Redirect to the main dashboard on success
                    window.location.href = response.redirect;
                }
            },
            error: function(xhr) {
                const res = xhr.responseJSON;
                // Display error message to the user (you can add a <div id="error-msg"> to your pug file)
                alert(res.message || 'Login failed.');
            }
        });
    });

    // Handle Signup Form Submission
    $('#signup-form').on('submit', function(e) {
        e.preventDefault();

        const data = {
            username: $('#username').val(),
            password: $('#password').val()
        };

        $.ajax({
            url: '/api/signup',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data),
            success: function(response) {
                if (response.success) {
                    alert(response.message);
                    window.location.href = '/login'; // Redirect to login page
                }
            },
            error: function(xhr) {
                const res = xhr.responseJSON;
                alert(res.message || 'Signup failed.');
            }
        });
    });
});