INSERT INTO Questions (question_text, option_a, option_b, option_c, option_d, correct_option) VALUES 
('Which of the following is a valid variable name in Python?', '1st_number', 'my-variable', '_my_var', 'my var', 'C'),
('What data type is the result of this assignment: x = 5.5?', 'int', 'float', 'str', 'bool', 'B'),
('How do you assign the string "Hello" to a variable named greeting?', 'greeting = "Hello"', 'String greeting = "Hello"', 'let greeting = "Hello"', 'greeting == "Hello"', 'A'),
('Which data type is used to store True or False values?', 'int', 'float', 'str', 'bool', 'D'),
('What is the output of type(10)?', '<class "float">', '<class "int">', '<class "str">', '<class "number">', 'B');

INSERT INTO PowerEffects (name, description) VALUES 
('Double Score', 'Doubles the points earned on the next successful turn.'),
('Skip Enemy', 'Allows you to bypass an Enemy Card quiz without answering and avoid losing points.'),
('Point Steal', 'Steals 10 points from the player currently in first place.');

-- Insert Empty Cards (Safe points)
INSERT INTO Cards (card_type, qr_code_value, power_effect_id) VALUES 
('Empty Card', 101, NULL),
('Empty Card', 102, NULL),
('Empty Card', 103, NULL);

-- Insert Enemy Cards (Triggers Quiz)
INSERT INTO Cards (card_type, qr_code_value, power_effect_id) VALUES 
('Enemy Card', 201, NULL),
('Enemy Card', 202, NULL),
('Enemy Card', 203, NULL);

-- Insert Power Cards (Links to the PowerEffects table via ID)
-- Assuming the PowerEffects inserted above got IDs 1, 2, and 3
INSERT INTO Cards (card_type, qr_code_value, power_effect_id) VALUES 
('Power Card', 301, 1), -- Double Score
('Power Card', 302, 2), -- Skip Enemy
('Power Card', 303, 3); -- Point Steal

select * from Questions;