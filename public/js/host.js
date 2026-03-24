$(document).ready(function() {
    if ($('.host-dashboard').length > 0) {
        
        // BGM Player Setup
        let bgmStarted = false;
        const bgmAudio = document.getElementById('bgm-audio');
        const bgmBtn = document.getElementById('bgm-toggle-btn');
        const bgmSlider = document.getElementById('bgm-volume-slider');

        bgmSlider.value = 0.02;
        bgmAudio.volume = bgmSlider.value;

        // Attempt to autoplay immediately
        const playPromise = bgmAudio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                bgmStarted = true;
            }).catch(e => {
                console.log('BGM autoplay prevented by browser. Muting audio.');
                bgmAudio.muted = true;
                bgmBtn.innerText = '🔇';
                
                // Fallback: wait for the user to interact with the document
                $(document).one('click', function() {
                    if (!bgmStarted) {
                        bgmAudio.play().catch(err => console.log('Playback error:', err));
                        bgmStarted = true;
                    }
                });
            });
        }
        // Mute / Unmute Toggle
        $('#bgm-toggle-btn').on('click', function(e) {
            e.stopPropagation();
            bgmAudio.muted = !bgmAudio.muted;
            bgmBtn.innerText = bgmAudio.muted ? '🔇' : '🔊';
            
            if (!bgmStarted) {
                bgmAudio.play().catch(e => console.log('Playback error:', e));
                bgmStarted = true;
            }
        });
        // Volume Slider Adjustment
        $('#bgm-volume-slider').on('input', function(e) {
            e.stopPropagation();
            bgmAudio.volume = $(this).val();
            bgmAudio.muted = (bgmAudio.volume == 0);
            bgmBtn.innerText = bgmAudio.muted ? '🔇' : '🔊';
        });

        let currentTurnId = null;
        let turnStartTime = Date.now();
        // Check every second if 10 seconds have passed since the turn started
        setInterval(function() {
            if (currentTurnId && (Date.now() - turnStartTime > 10000)) {
                $('#skip-turn-btn').show();
            } else {
                $('#skip-turn-btn').hide();
            }
        }, 1000);

        // Handle Skip Turn button click
        $(document).on('click', '#skip-turn-btn', function(e) {
            e.preventDefault();
            
            const btn = $(this);

            showConfirm('Are you sure you want to skip the current player\'s turn? This is for when a player disconnects and cannot continue.', function() {
                btn.prop('disabled', true).text('Skipping...');

                $.ajax({
                    url: '/api/skip-turn',
                    method: 'POST',
                    success: function(response) {
                        showAlert(response.message || 'Turn has been skipped.');
                        turnStartTime = Date.now();
                        $('#skip-turn-btn').hide();
                    },
                    error: function(xhr) {
                        showAlert(xhr.responseJSON?.message || 'Failed to skip the turn.');
                    },
                    complete: function() {
                        btn.prop('disabled', false).text('Skip Current Turn');
                    }
                });
            });
        });

        // Event delegation for text-to-speech button
        $(document).on('click', '#read-question-btn', function() {
            const textToRead = $(this).attr('data-question');
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel(); // Stop any currently playing speech
                const utterance = new SpeechSynthesisUtterance(textToRead);
                window.speechSynthesis.speak(utterance);
            } else {
                showAlert("Text-to-speech is not supported in this browser.");
            }
        });

        function pollHostData() {
            $.ajax({
                url: '/api/host-data',
                method: 'GET',
                success: function(response) {
                    if (response.success) {
                        
                        // Update turn tracking
                        if (response.currentTurnParticipantId !== currentTurnId) {
                            currentTurnId = response.currentTurnParticipantId;
                            turnStartTime = Date.now();
                            $('#skip-turn-btn').hide();
                        }

                        // Update the Leaderboard
                        const rankingBody = $('#ranking-body');
                        rankingBody.empty();
                        
                        response.leaderboard.forEach((player, index) => {
                            rankingBody.append(`
                                <tr>
                                    <td>${index + 1}</td>
                                    <td>${player.username}</td>
                                    <td>${player.current_score}</td>
                                </tr>
                            `);
                        });

                        // 2. Update the Game Log
                        const gameLogList = $('#game-log');
                        gameLogList.empty();

                        response.logs.forEach(log => {
                            let logMessage = `<strong>${log.username}</strong> drew a <em>${log.card_type}</em>.`;
                            
                            // Customize message based on what happened
                            if (log.card_type === 'Enemy Card') {
                                if (log.power_name === 'Skip Enemy') {
                                    logMessage += ` Bypassed using power.`;
                                } else if (log.is_correct) {
                                    logMessage += ` Answered correctly (+${log.points_earned} pts).`;
                                    if (log.power_name === 'Double Score') logMessage += ' (Double Score applied!)';
                                } else {
                                    logMessage += ` Answered incorrectly (0 pts).`;
                                }
                            } else if (log.card_type === 'Empty Card') {
                                logMessage += ` (+${log.points_earned} pts).`;
                                if (log.power_name === 'Double Score') logMessage += ' (Double Score applied!)';
                            } else if (log.card_type === 'Power Card' && log.power_name) {
                                logMessage += ` Gained power: ${log.power_name}.`;
                            }

                            gameLogList.append(`<li>${logMessage}</li>`);
                        });
                        
                        // Update the Question Board
                        if (response.activeQuestion) {
                            const qInfo = response.activeQuestion.question;
                            
                            const readBtn = $('<button>')
                                .attr('id', 'read-question-btn')
                                .attr('title', 'Read question aloud')
                                .attr('data-question', qInfo.question_text)
                                .css({ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'inherit' })
                                .text('🔊');
                                
                            $('#current-question').empty().text(qInfo.question_text + ' ').append(readBtn);
                            $('#active-player-name').text(response.activeQuestion.username);
                            
                            const optionsList = $('#current-options');
                            optionsList.empty();
                            optionsList.append(`<li class="option">A: ${qInfo.option_a}</li>`);
                            optionsList.append(`<li class="option">B: ${qInfo.option_b}</li>`);
                            optionsList.append(`<li class="option">C: ${qInfo.option_c}</li>`);
                            optionsList.append(`<li class="option">D: ${qInfo.option_d}</li>`);
                        } else {
                            $('#current-question').text('Waiting for a player to scan an Enemy Card...');
                            $('#active-player-name').text('...');
                            $('#current-options').html('<li class="option">No active question</li>');
                        }
                    }
                },
                complete: function() {
                    setTimeout(pollHostData, 2000);
                }
            });
        }
        pollHostData();
    }
});