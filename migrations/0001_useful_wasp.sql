CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`window` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key`, `window`)
);
