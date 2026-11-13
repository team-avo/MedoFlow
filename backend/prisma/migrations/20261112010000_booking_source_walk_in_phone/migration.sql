-- CTO-24: owners and admins book walk-ins and phone bookings themselves.
ALTER TYPE "BookingSource" ADD VALUE IF NOT EXISTS 'WALK_IN';
ALTER TYPE "BookingSource" ADD VALUE IF NOT EXISTS 'PHONE';
