// Utility function to switch player screens
function showGameState(stateId) {
  // Hide all states
  document.querySelectorAll('.game-state').forEach(state => {
    state.classList.add('hidden');
  });
  
  // Show the requested state
  const activeState = document.getElementById(stateId);
  if (activeState) {
    activeState.classList.remove('hidden');
  }

  // Dispatch a custom event so other components (like the scanner) can react
  document.dispatchEvent(new CustomEvent('gameStateChanged', { detail: { stateId } }));
}

// Example: Simulating game flow for testing
// In reality, these will be triggered by Socket.io or AJAX responses
document.addEventListener('DOMContentLoaded', () => {
  
  const powerOkBtn = document.getElementById('btn-power-ok');
  if(powerOkBtn) {
    powerOkBtn.addEventListener('click', () => {
       // Return to scanner state to allow continuous testing
       showGameState('state-scanner');
    });
  }
});

$(document).ready(function() {
    let html5QrcodeScanner;

    function startScanner() {
        if (!html5QrcodeScanner) {
            html5QrcodeScanner = new Html5QrcodeScanner(
                "reader",
                { fps: 10, qrbox: { width: 250, height: 250 } },
                false
            );
            html5QrcodeScanner.render(onScanSuccess);
        }
    }

    function stopScanner() {
        if (html5QrcodeScanner) {
            html5QrcodeScanner.clear().catch(error => {
                console.error("Failed to clear scanner: ", error);
            });
            html5QrcodeScanner = null;
        }
    }

    function onScanSuccess(decodedText, decodedResult) {
        // Stop the scanner immediately upon successful read to prevent duplicate calls
        stopScanner();
        processScannedCard(decodedText);
    }

    document.addEventListener('gameStateChanged', function(e) {
        if (e.detail.stateId === 'state-scanner') {
            startScanner();
        } else {
            stopScanner();
        }
    });

    // Function to handle the scanned QR code value
    function processScannedCard(qrCodeValue) {
        $.ajax({
            url: '/api/scan-card',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ qrCodeValue: qrCodeValue }),
            success: function(response) {
                if (response.success) {
                    
                    // Route to the correct UI state based on the card drawn
                    if (response.cardType === 'Empty Card') {
                        $('#empty-points-granted').text(response.message || `+${response.points} points granted`);
                        showGameState('state-empty-card');
                        
                    } else if (response.cardType === 'Power Card') {
                        $('#state-power-card h2').text(`Congrats! You drew: ${response.effectName}`);
                        $('#power-description').text(response.effectDescription);
                        showGameState('state-power-card');
                        
                    } else if (response.cardType === 'Enemy Card') {
                        // If the Point Steal triggers exactly on an Enemy card draw, notify them
                        if (response.message) {
                            alert(response.message);
                        }
                        // Populate the question UI
                        const q = response.question;
                        $('#state-enemy-card .question-box h3').text(q.question_text);
                        
                        const answersBox = $('#state-enemy-card .answers-box');
                        answersBox.empty(); // Clear old buttons
                        
                        // Create buttons for options A, B, C, D
                        const options = [
                            { key: 'A', text: q.option_a },
                            { key: 'B', text: q.option_b },
                            { key: 'C', text: q.option_c },
                            { key: 'D', text: q.option_d }
                        ];
                        
                        options.forEach(opt => {
                            answersBox.append(`
                                <button class="btn btn-answer" data-option="${opt.key}">
                                    ${opt.key}: ${opt.text}
                                </button>
                            `);
                        });
                        
                        showGameState('state-enemy-card');
                    }
                }
            },
            error: function(xhr) {
                alert(xhr.responseJSON?.message || 'Error processing card.');
                // Return to scanner to try again
                showGameState('state-scanner');
            }
        });
    }

    // --- FOR TESTING: Mocking a scan ---
    // You can add an input and button to the #state-scanner div to manually type a qr_code_value
    $('#mock-scan-btn').on('click', function() {
        const val = $('#mock-scan-input').val();
        processScannedCard(val);
    });

    window.isMyTurn = false; // Globally track the turn

    // Handle returning to the lobby/scanner after viewing an Empty or Power card
    $('#btn-power-ok').on('click', function() {
        showGameState(window.isMyTurn ? 'state-scanner' : 'state-waiting'); 
    });

    // Handle acknowledging the Empty card
    $('#btn-empty-ok').on('click', function() {
        showGameState(window.isMyTurn ? 'state-scanner' : 'state-waiting'); 
    });

    
    // Handle Answer Submission (Event Delegation)
    $('#state-enemy-card .answers-box').on('click', '.btn-answer', function(e) {
        e.preventDefault();

        // Extract the selected option (A, B, C, or D) from the data attribute
        const selectedOption = $(this).data('option');
        
        // Disable all answer buttons to prevent multiple clicks
        $('#state-enemy-card .btn-answer').prop('disabled', true);

        $.ajax({
            url: '/api/submit-answer',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ selectedOption: selectedOption }),
            success: function(response) {
                if (response.success) {
                    // Display the result to the user
                    if (response.isCorrect) {
                        alert(`Correct! You earned ${response.pointsEarned} points!`);
                    } else {
                        alert('Incorrect! Better luck next time.');
                    }
                    
                    // Return the player to the scanner state for continuous testing
                    showGameState(window.isMyTurn ? 'state-scanner' : 'state-waiting');
                    
                    // Re-enable buttons for the next time this screen is shown
                    $('#state-enemy-card .btn-answer').prop('disabled', false);
                }
            },
            error: function(xhr) {
                alert(xhr.responseJSON?.message || 'Error submitting answer.');
                $('#state-enemy-card .btn-answer').prop('disabled', false);
            }
        });
    });

    // Initially wait until polling confirms it's the player's turn
    showGameState('state-waiting');

    // Poll the game state to check if the host ends the game
    let gamePollTimer;
    function pollGameState() {
        $.ajax({
            url: '/api/lobby-status',
            method: 'GET',
            success: function(data) {
                if (data.status === 'ended') {
                    alert('The host has ended the game.');
                    window.location.href = '/';
                } else if (window.location.pathname === '/game') {
                    window.isMyTurn = data.isMyTurn;

                    // Transition to scanner if it becomes our turn and we are waiting
                    if (data.isMyTurn && !$('#state-waiting').hasClass('hidden')) {
                        showGameState('state-scanner');
                    } 
                    // Transition to waiting if it stops being our turn and we are scanning
                    else if (!data.isMyTurn && !$('#state-scanner').hasClass('hidden')) {
                        showGameState('state-waiting');
                    }

                    gamePollTimer = setTimeout(pollGameState, 2000);
                }
            },
            error: function(xhr) {
                // If the server returns 400 (No active lobby), the session was cleared/ended
                if (xhr.status === 400) {
                    window.location.href = '/';
                } else if (window.location.pathname === '/game') {
                    gamePollTimer = setTimeout(pollGameState, 2000);
                }
            }
        });
    }

    if (window.location.pathname === '/game') {
        pollGameState();
    }
});