# Feature: Set AIROLIT_SERIAL via Web Serial

## Status: Implementation Complete - Needs Testing

## What Was Implemented

This feature allows users to set the `AIROLIT_SERIAL` parameter on a drone when:
1. Connected via Web Serial API (USB)
2. The current serial is a "default" value (0, null, or matches pattern `16925X0000`)

### Files Modified

1. **`src/lib/mavlink.ts`** - Added MAVLink parameter protocol support:
   - `MSG_ID_PARAM_REQUEST_READ` (20), `MSG_ID_PARAM_VALUE` (22), `MSG_ID_PARAM_SET` (23)
   - `ParamValueMessage` interface
   - `createParamRequestReadMessage()` - request parameter by name
   - `createParamSetMessage()` - set parameter value
   - `parseParamValue()` - parse PARAM_VALUE response
   - `intToParamFloat()` / `paramFloatToUint()` - MAVLink int32-as-float encoding

2. **`src/lib/droneConnection.ts`** - Added parameter read/write methods:
   - `requestParameter(paramId)` - generic parameter read
   - `setParameter(paramId, value, type)` - generic parameter write
   - `readAirolitSerial()` - read AIROLIT_SERIAL as integer
   - `setAirolitSerial(serial)` - set and verify AIROLIT_SERIAL

3. **`src/components/SetSerialModal.tsx`** (NEW) - Modal UI for setting serial:
   - Input validation (10 digits, not a default pattern)
   - Progress states: input → setting → verifying → success/error
   - Verification by reading back after write
   - Exports `isDefaultSerial()` helper

4. **`src/components/DroneConnection.tsx`** - UI integration:
   - Reads AIROLIT_SERIAL on connection
   - Detects default serials
   - Shows amber "Set Serial" button when needed
   - Opens modal on click

### Default Serial Detection

Recognized as defaults:
- `null` or `0`
- Pattern `16925X0000` where X is any digit (e.g., `1692500000` for XLT, `1692510000` for CX10)

## Testing Needed

1. **With actual drone hardware:**
   - Connect via USB serial
   - Verify AIROLIT_SERIAL is read correctly
   - Verify default detection works
   - Test setting a new serial number
   - Verify the value persists after drone reboot

2. **Edge cases:**
   - Drone without AIROLIT_SERIAL parameter
   - Connection loss during set operation
   - Invalid serial number input validation

## Potential Future Improvements

1. **Persist across reboots**: The parameter may need `param save` command to persist to EEPROM
2. **Better error messages**: More specific errors for different failure modes
3. **Retry logic**: Auto-retry on timeout
4. **Serial format guidance**: Show expected format based on drone model

## Related Backend Code

The backend (`airolog/client/airolit_drone_api.py`) has similar functionality via pymavlink:
- `get_serial()` - reads AIROLIT_SERIAL
- `set_serial()` - writes AIROLIT_SERIAL

The validation logic in `backend/routers/logs.py` uses the same default pattern detection.
