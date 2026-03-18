-- CREATE DATABASE IF NOT EXISTS DrawAndDare;
USE DrawAndDare;

CREATE TABLE `Users` (
  `user_id` int PRIMARY KEY AUTO_INCREMENT,
  `username` varchar(255),
  `password_hash` varchar(255)
);

CREATE TABLE `Lobby` (
  `lobby_id` int PRIMARY KEY AUTO_INCREMENT,
  `host_user_id` int,
  `status` varchar(255),
  `lobby_code` varchar(255),
  `current_turn_participant_id` int
);

CREATE TABLE `Participants` (
  `participant_id` int PRIMARY KEY AUTO_INCREMENT,
  `lobby_id` int,
  `user_id` int,
  `current_score` int,
  `active_effect_id` int,
  `score_updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `PowerEffects` (
  `power_effect_id` int PRIMARY KEY AUTO_INCREMENT,
  `name` varchar(255),
  `description` text
);

CREATE TABLE `Cards` (
  `card_id` int PRIMARY KEY AUTO_INCREMENT,
  `card_type` varchar(255),
  `qr_code_value` int
);

CREATE TABLE `Questions` (
  `question_id` int PRIMARY KEY AUTO_INCREMENT,
  `question_text` text,
  `option_a` varchar(255),
  `option_b` varchar(255),
  `option_c` varchar(255),
  `option_d` varchar(255),
  `correct_option` varchar(255)
);

CREATE TABLE `GameLog` (
  `turn_id` int PRIMARY KEY AUTO_INCREMENT,
  `lobby_id` int,
  `participant_id` int,
  `question_id` int,
  `card_id` int,
  `applied_effect_id` int,
  `points_earned` int,
  `is_correct` boolean
);

ALTER TABLE `Lobby` ADD FOREIGN KEY (`host_user_id`) REFERENCES `Users` (`user_id`);
ALTER TABLE `Participants` ADD FOREIGN KEY (`lobby_id`) REFERENCES `Lobby` (`lobby_id`);
ALTER TABLE `Participants` ADD FOREIGN KEY (`user_id`) REFERENCES `Users` (`user_id`);
ALTER TABLE `Participants` ADD FOREIGN KEY (`active_effect_id`) REFERENCES `PowerEffects` (`power_effect_id`);
ALTER TABLE `GameLog` ADD FOREIGN KEY (`participant_id`) REFERENCES `Participants` (`participant_id`);
ALTER TABLE `GameLog` ADD FOREIGN KEY (`question_id`) REFERENCES `Questions` (`question_id`);
ALTER TABLE `GameLog` ADD FOREIGN KEY (`card_id`) REFERENCES `Cards` (`card_id`);
ALTER TABLE `GameLog` ADD FOREIGN KEY (`applied_effect_id`) REFERENCES `PowerEffects` (`power_effect_id`);
ALTER TABLE `GameLog` ADD FOREIGN KEY (`lobby_id`) REFERENCES `Lobby` (`lobby_id`);
ALTER TABLE `Lobby` ADD FOREIGN KEY (`current_turn_participant_id`) REFERENCES `Participants` (`participant_id`);
