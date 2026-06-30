-- Optional cutoff for a recurring schedule: once its cursor passes this date
-- it stops applying occurrences and deactivates itself, same as a liability
-- being paid off. NULL (the default) means it runs forever, as today.

ALTER TABLE recurring_transactions ADD COLUMN end_date TEXT;
