// Show Alert Modal
function showAlert(message, callback) {
    let modal = $('#custom-alert-modal');
    if (modal.length === 0) {
        const modalHtml = `
            <div id="custom-alert-modal" class="modal" style="display: none;">
                <div class="modal-content">
                    <p id="custom-alert-message"></p>
                    <button id="custom-alert-ok" class="btn btn-primary">OK</button>
                </div>
            </div>
        `;
        $('body').append(modalHtml);
        modal = $('#custom-alert-modal');

        $('#custom-alert-ok').on('click', function() {
            modal.css('display', 'none');
            if (typeof modal.data('callback') === 'function') {
                modal.data('callback')();
            }
        });
    }
    
    $('#custom-alert-message').text(message);
    modal.data('callback', callback); // Save the callback function if provided
    modal.css('display', 'flex');
}

// Show Confirm Modal
function showConfirm(message, onConfirm) {
    let modal = $('#custom-confirm-modal');
    if (modal.length === 0) {
        const modalHtml = `
            <div id="custom-confirm-modal" class="modal" style="display: none;">
                <div class="modal-content">
                    <p id="custom-confirm-message" style="margin-bottom: 1.5rem; font-size: 1.2rem; font-weight: bold;"></p>
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button id="custom-confirm-yes" class="btn btn-primary">Yes</button>
                        <button id="custom-confirm-no" class="btn btn-secondary">No</button>
                    </div>
                </div>
            </div>
        `;
        $('body').append(modalHtml);
        modal = $('#custom-confirm-modal');

        $('#custom-confirm-yes').on('click', function() {
            modal.css('display', 'none');
            if (typeof modal.data('onConfirm') === 'function') {
                modal.data('onConfirm')();
            }
        });

        $('#custom-confirm-no').on('click', function() {
            modal.css('display', 'none');
        });
    }
    
    $('#custom-confirm-message').text(message);
    modal.data('onConfirm', onConfirm);
    modal.css('display', 'flex');
}

document.addEventListener('DOMContentLoaded', () => {
  // Sidebar Toggle
  const menuBtn = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');

  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('active');
    });

    // Close sidebar when clicking outside of it
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('active') && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
        sidebar.classList.remove('active');
      }
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

    // Close modal when clicking outside of its content
    pwdModal.addEventListener('click', (e) => {
      if (e.target === pwdModal) {
        pwdModal.classList.add('hidden');
      }
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
            setTimeout(pollLobby, 2000);
        }
    });
}

// Start polling on the lobby page
if (window.location.pathname === '/lobby') {
    pollLobby();
}


$(document).ready(function() {
    // Handle Create Session Button Click
    $('#create-session-btn').on('click', function(e) {
        e.preventDefault();

        // to prevent double-clicks
        $(this).prop('disabled', true).text('Creating...');

        $.ajax({
            url: '/api/create-lobby',
            method: 'POST',
            success: function(response) {
                if (response.success) {
                    $('#create-session-btn').prop('disabled', false).text('Create Session'); // Set back to original status
                    // Redirect the player to the waiting room
                    window.location.href = response.redirect;
                }
            },
            error: function(xhr) {
                const res = xhr.responseJSON;
                showAlert(res.message || 'Failed to create lobby.');
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

        // Visual feedback and prevent multiple clicks
        submitBtn.prop('disabled', true).text('Joining...');

        $.ajax({
            url: '/api/join-lobby',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ lobbyCode: lobbyCode }),
            success: function(response) {
                if (response.success) {
                    // Redirect to the newly created lobby
                    window.location.href = response.redirect;
                }
            },
            error: function(xhr) {
                const res = xhr.responseJSON;
                showAlert(res.message || 'Failed to join lobby.');
                // If there's an error so they can try again
                submitBtn.prop('disabled', false).text('Join');
            }
        });
    });

});

$(document).ready(function() {
    // Start the Game (Host)
    $('#start-game-btn').on('click', function(e) {
        e.preventDefault();

        const btn = $(this);
        btn.prop('disabled', true).text('Starting...');

        $.ajax({
            url: '/api/start-game',
            method: 'POST',
            success: function(response) {
                if (response.success) {
                    // Direct to Game
                    window.location.href = response.redirect;
                }
            },
            error: function(xhr) {
                showAlert(xhr.responseJSON?.message || 'Failed to start the game.');
                btn.prop('disabled', false).text('Start!');
            }
        });
    });

    // End the Game (Host)
    $('#end-game-btn').on('click', function(e) {
        e.preventDefault();
        
        const btn = $(this);

        showConfirm('Are you sure you want to end this game?', function() {
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
                    showAlert(xhr.responseJSON?.message || 'Failed to end the game.');
                    btn.prop('disabled', false).text('End Game');
                }
            });
        });
    });

    // AJAX Polling for the Lobby State
    function pollLobby() {
        $.ajax({
            url: '/api/lobby-status',
            method: 'GET',
            success: function(data) {
                // Update UI with new participants
                const list = $('#participants-list');
                list.empty();
                
                if (data.participants && data.participants.length > 0) {
                    data.participants.forEach(p => {
                        list.append(`<li>${p.username}</li>`);
                    });
                } else {
                    list.append('<li>Waiting for players...</li>');
                }

                // redirects all players currently sitting in the lobby
                if (data.status === 'playing') {
                    window.location.href = '/game'; 
                }
            },
            complete: function() {
                // Poll again if still on lobby page
                if (window.location.pathname === '/lobby') {
                    setTimeout(pollLobby, 2000);
                }
            }
        });
    }

    // Initialize polling on the lobby page
    if (window.location.pathname === '/lobby') {
        pollLobby();
    }

});