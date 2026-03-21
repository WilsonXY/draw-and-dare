$(document).ready(function() {
    if ($('.host-dashboard').length > 0) {
        // Event delegation for text-to-speech button
        $(document).on('click', '#read-question-btn', function() {
            const textToRead = $(this).attr('data-question');
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel(); // Stop any currently playing speech
                const utterance = new SpeechSynthesisUtterance(textToRead);
                window.speechSynthesis.speak(utterance);
            } else {
                alert("Text-to-speech is not supported in this browser.");
            }
        });

        function pollHostData() {
            $.ajax({
                url: '/api/host-data',
                method: 'GET',
                success: function(response) {
                    if (response.success) {
                        
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