document.addEventListener('DOMContentLoaded', () => {
  // Sidebar Toggle
  const menuBtn = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');

  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('active');
    });
  }

  // Change Password Modal Toggle
  const changePwdBtn = document.getElementById('change-pwd-btn');
  const pwdModal = document.getElementById('password-modal');
  const closePwdModal = document.getElementById('close-modal');

  if (changePwdBtn && pwdModal) {
    changePwdBtn.addEventListener('click', (e) => {
      e.preventDefault();
      pwdModal.classList.remove('hidden');
      sidebar.classList.remove('active'); // Close sidebar when modal opens
    });

    closePwdModal.addEventListener('click', () => {
      pwdModal.classList.add('hidden');
    });
  }
});

function pollLobby() {
    $.ajax({
        url: '/api/lobby-status',
        method: 'GET',
        success: function(data) {
            // Update the UI with new participants
            $('#participants-list').empty();
            data.participants.forEach(p => {
                $('#participants-list').append(`<li>${p.username}</li>`);
            });

            // Check if host started the game
            if (data.status === 'playing') {
                window.location.href = '/game'; // Redirect player to game view
            }
        },
        complete: function() {
            // Poll again after 2 seconds
            setTimeout(pollLobby, 2000);
        }
    });
}

// Start polling if we are on the lobby page
if (window.location.pathname === '/lobby') {
    pollLobby();
}


$(document).ready(function() {
    
    // Handle Create Session Button Click
    $('#create-session-btn').on('click', function(e) {
        e.preventDefault();

        // Optional: Disable button to prevent double-clicks
        $(this).prop('disabled', true).text('Creating...');

        $.ajax({
            url: '/api/create-lobby',
            method: 'POST',
            success: function(response) {
                if (response.success) {
                    // Redirect to the newly created lobby
                    window.location.href = response.redirect;
                }
            },
            error: function(xhr) {
                const res = xhr.responseJSON;
                alert(res.message || 'Failed to create lobby.');
                $('#create-session-btn').prop('disabled', false).text('Create Session');
            }
        });
    });

});


$(document).ready(function() {
    
    // Handle Join Session Form Submission
    $('#join-form').on('submit', function(e) {
        e.preventDefault();

        const lobbyCode = $('#lobby-code').val().trim();
        const submitBtn = $(this).find('button[type="submit"]');

        // Provide visual feedback and prevent multiple clicks
        submitBtn.prop('disabled', true).text('Joining...');

        $.ajax({
            url: '/api/join-lobby',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ lobbyCode: lobbyCode }),
            success: function(response) {
                if (response.success) {
                    // Redirect the player to the waiting room
                    window.location.href = response.redirect;
                }
            },
            error: function(xhr) {
                const res = xhr.responseJSON;
                alert(res.message || 'Failed to join lobby.');
                // Reset the button if there's an error so they can try again
                submitBtn.prop('disabled', false).text('Join');
            }
        });
    });

});

$(document).ready(function() {
    // Host Action: Start the Game
    $('#start-game-btn').on('click', function(e) {
        e.preventDefault();

        const btn = $(this);
        btn.prop('disabled', true).text('Starting...');

        $.ajax({
            url: '/api/start-game',
            method: 'POST',
            success: function(response) {
                if (response.success) {
                    // The host redirects immediately; the players will follow via polling
                    window.location.href = response.redirect;
                }
            },
            error: function(xhr) {
                alert(xhr.responseJSON?.message || 'Failed to start the game.');
                btn.prop('disabled', false).text('Start!');
            }
        });
    });

    // Host Action: End the Game
    $('#end-game-btn').on('click', function(e) {
        e.preventDefault();
        
        if (!confirm('Are you sure you want to end this game?')) {
            return;
        }

        const btn = $(this);
        btn.prop('disabled', true).text('Ending...');

        $.ajax({
            url: '/api/end-game',
            method: 'POST',
            success: function(response) {
                if (response.success) {
                    window.location.href = response.redirect;
                }
            },
            error: function(xhr) {
                alert(xhr.responseJSON?.message || 'Failed to end the game.');
                btn.prop('disabled', false).text('End Game');
            }
        });
    });

    // AJAX Polling for the Lobby State
    function pollLobby() {
        $.ajax({
            url: '/api/lobby-status',
            method: 'GET',
            success: function(data) {
                // Update the UI with new participants dynamically
                const list = $('#participants-list');
                list.empty();
                
                if (data.participants && data.participants.length > 0) {
                    data.participants.forEach(p => {
                        list.append(`<li>${p.username}</li>`);
                    });
                } else {
                    list.append('<li>Waiting for players...</li>');
                }

                // If the host clicked start, the status changes to 'playing'
                // This redirects all players currently sitting in the lobby
                if (data.status === 'playing') {
                    window.location.href = '/game'; 
                }
            },
            complete: function() {
                // Poll again after 2 seconds only if we are still on the lobby page
                if (window.location.pathname === '/lobby') {
                    setTimeout(pollLobby, 2000);
                }
            }
        });
    }

    // Initialize polling strictly on the lobby page
    if (window.location.pathname === '/lobby') {
        pollLobby();
    }

});