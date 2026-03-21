$(document).ready(function() {
    
    // Handle Login Form Submission
    $('#login-form').on('submit', function(e) {
        e.preventDefault();

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
                showAlert(res.message || 'Login failed.');
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
                    showAlert(response.message, function() {
                        window.location.href = '/login'; // Redirect to login page
                    });
                }
            },
            error: function(xhr) {
                const res = xhr.responseJSON;
                showAlert(res.message || 'Signup failed.');
            }
        });
    });
});

$(document).ready(function() {
    // show the change password modal
    $('#change-pwd-btn').on('click', function(e) {
        e.preventDefault();
        $('#password-modal').removeClass('hidden');
    });

    // close the change password modal and clear input
    $('#close-modal').on('click', function() {
        $('#password-modal').addClass('hidden');
        $('#new-password').val('');
    });

    // close the change password modal when clicking outside the content
    $('#password-modal').on('click', function(e) {
        if (e.target === this) {
            $(this).addClass('hidden');
            $('#new-password').val('');
        }
    });

    // submit the new password
    $('#apply-pwd').on('click', function() {
        const newPassword = $('#new-password').val();

        if (!newPassword || newPassword.trim() === '') {
            showAlert('Please enter a new password.');
            return;
        }

        $.ajax({
            url: '/api/change-password',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ newPassword: newPassword }),
            success: function(response) {
                if (response.success) {
                    showAlert(response.message);
                    $('#password-modal').addClass('hidden');
                    $('#new-password').val('');
                } else {
                    showAlert(response.message || 'Error changing password');
                }
            },
            error: function(xhr) {
                const res= xhr.responseJSON;
                showAlert(res && res.message ? res.message: 'Server error. Please try again later.');
            }
        });
    });
});