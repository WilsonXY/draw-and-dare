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
}

// Example: Simulating game flow for testing
// In reality, these will be triggered by Socket.io or AJAX responses
document.addEventListener('DOMContentLoaded', () => {
  // Uncomment below to test specific screens during development:
  // showGameState('state-scanner'); 
  // showGameState('state-enemy-card');
  // showGameState('state-game-ended');
  
  const powerOkBtn = document.getElementById('btn-power-ok');
  if(powerOkBtn) {
    powerOkBtn.addEventListener('click', () => {
       // Return to waiting or scanner state after acknowledging power card
       showGameState('state-waiting');
    });
  }
});

$(document).ready(function() {
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
                        $('#empty-points-granted').text(`+${response.points} points granted`);
                        showGameState('state-empty-card');
                        
                    } else if (response.cardType === 'Power Card') {
                        $('#state-power-card h2').text(`Congrats! You drew: ${response.effectName}`);
                        $('#power-description').text(response.effectDescription);
                        showGameState('state-power-card');
                        
                    } else if (response.cardType === 'Enemy Card') {
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

    // Handle returning to the lobby/scanner after viewing an Empty or Power card
    $('#btn-power-ok').on('click', function() {
        showGameState('state-waiting'); // Or 'state-scanner' depending on turn logic
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
                    
                    // Return the player to the waiting state for the next turn
                    showGameState('state-waiting');
                    
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
});