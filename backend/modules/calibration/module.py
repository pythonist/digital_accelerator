import traceback


def load_calibration_db(run_migrations=None):
    try:
        from calibration.services.calibration_db_schema import CalibrationDatabaseManager
    except Exception as e:
        print(f"⚠️ Calibration DB module unavailable: {e}")
        traceback.print_exc()
        return None
    mgr = CalibrationDatabaseManager()
    if run_migrations:
        try:
            conn = mgr.connect()
            run_migrations(conn)
            conn.close()
        except Exception:
            traceback.print_exc()
    return mgr


def load_percentile_engine(calibration_db):
    try:
        from calibration.builder.percentile_engine import PercentileEngine
    except Exception as e:
        print(f"⚠️ Percentile engine unavailable: {e}")
        traceback.print_exc()
        return None
    if not calibration_db:
        raise RuntimeError("Calibration DB required for percentile engine")
    return PercentileEngine(calibration_db)


def load_threshold_simulator(calibration_db):
    try:
        from calibration.builder.threshold_simulator import ThresholdSimulator
    except Exception as e:
        print(f"⚠️ Threshold simulator unavailable: {e}")
        traceback.print_exc()
        return None
    if not calibration_db:
        raise RuntimeError("Calibration DB required for threshold simulator")
    return ThresholdSimulator(calibration_db)

