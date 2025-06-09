import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    log_loss,
    confusion_matrix,
    # roc_curve, # Not returning these directly, but could be used for plots
    # precision_recall_curve, # Not returning these directly
    # auc # For PR curve AUC if needed
)
from tensorflow import keras # For type hinting Keras model
import numpy as np
from typing import Dict, Any, Union
import xgboost as xgb # For type hinting
import lightgbm as lgb # For type hinting


def evaluate_model(
    model: Union[keras.Model, xgb.XGBClassifier, lgb.LGBMClassifier, Any],
    X_test: pd.DataFrame,
    y_test: pd.Series,
    model_type: str = "unknown"
) -> Dict[str, Any]:
    """
    Evaluates a trained model on the test set.

    Args:
        model: The trained model instance (Keras, XGBoost, LightGBM, or scikit-learn compatible).
        X_test (pd.DataFrame): Test features.
        y_test (pd.Series): True labels for the test set.
        model_type (str): String identifier for model type, e.g., "neural_network",
                          "xgboost", "lightgbm". Used to handle different prediction methods.

    Returns:
        Dict[str, Any]: A dictionary containing various evaluation metrics.
    """
    print(f"Evaluating model of type: {model_type}...")

    y_pred_proba: Optional[np.ndarray] = None
    y_pred_class: Optional[np.ndarray] = None

    try:
        if model_type == "neural_network" and isinstance(model, keras.Model):
            y_pred_proba = model.predict(X_test).ravel()
        elif hasattr(model, "predict_proba"):
            y_pred_proba = model.predict_proba(X_test)[:, 1]
        else: # Fallback if no predict_proba
            print(f"Warning: Model type {model_type} or instance lacks 'predict_proba'. Using 'predict' for probabilities if possible.")
            if hasattr(model, "predict"):
                y_pred_class_for_proba = model.predict(X_test) # This might be classes or continuous for regressors
                # Attempt to use it as probabilities if it's float, otherwise it's classes
                if np.issubdtype(y_pred_class_for_proba.dtype, np.floating):
                     y_pred_proba = y_pred_class_for_proba.ravel() if y_pred_class_for_proba.ndim > 1 else y_pred_class_for_proba
                else: # if it's already classes (e.g. int)
                    y_pred_proba = y_pred_class_for_proba # Store it, will be used for y_pred_class later
            else:
                raise ValueError(f"Model type {model_type} has neither 'predict_proba' nor 'predict' method.")

        # Determine class predictions
        if y_pred_proba is not None:
            y_pred_class = (y_pred_proba > 0.5).astype(int)
        elif hasattr(model, "predict"): # If y_pred_proba could not be determined but predict exists
             y_pred_class_direct = model.predict(X_test)
             # Ensure y_pred_class_direct is 1D array of integers
             if y_pred_class_direct.ndim > 1 and y_pred_class_direct.shape[1] == 1:
                 y_pred_class_direct = y_pred_class_direct.ravel()
             if not np.issubdtype(y_pred_class_direct.dtype, np.integer): # If predict() returns float, threshold it
                 y_pred_class = (y_pred_class_direct > 0.5).astype(int)
             else:
                 y_pred_class = y_pred_class_direct.astype(int)
        else: # Should have been caught by the error above
            raise ValueError("Cannot make predictions with this model.")

    except Exception as e:
        print(f"Error during model prediction for model type {model_type}: {e}. Cannot evaluate.")
        return {"error_prediction": str(e)}

    results: Dict[str, Any] = {}
    try:
        results["accuracy"] = accuracy_score(y_test, y_pred_class)
        results["precision"] = precision_score(y_test, y_pred_class, zero_division=0)
        results["recall"] = recall_score(y_test, y_pred_class, zero_division=0)
        results["f1_score"] = f1_score(y_test, y_pred_class, zero_division=0)

        if y_pred_proba is not None:
            # Ensure y_pred_proba is truly probabilities (0-1 range) before calculating metrics that require it
            # For example, if predict_proba was missing and predict() returned class labels {0,1},
            # roc_auc_score might still work, but log_loss would be problematic.
            is_proba_meaningful = not (np.array_equal(y_pred_proba, y_pred_proba.astype(bool)) and len(np.unique(y_pred_proba)) <=2 )

            if is_proba_meaningful:
                results["roc_auc"] = roc_auc_score(y_test, y_pred_proba)
                results["log_loss"] = log_loss(y_test, y_pred_proba)
            else: # y_pred_proba likely contains class labels {0,1}
                print("Note: Meaningful probabilities not available. ROC AUC from class predictions. LogLoss may be misleading.")
                results["roc_auc"] = roc_auc_score(y_test, y_pred_class) # AUC from hard predictions
                # Log loss is not very informative with hard predictions if they are not true probabilities
                try:
                    results["log_loss"] = log_loss(y_test, y_pred_class.astype(float)) # Attempt, but may warn or error
                except ValueError as log_loss_err:
                    results["log_loss"] = f"Error: {log_loss_err} (likely due to non-probabilistic input)"


        # Confusion Matrix (tn, fp, fn, tp)
        # Ensure y_pred_class is not None (should be handled by prediction logic)
        if y_pred_class is not None:
            cm = confusion_matrix(y_test, y_pred_class)
            if cm.size == 4: # For binary classification
                tn, fp, fn, tp = cm.ravel()
                results["confusion_matrix"] = {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}
            else: # Multiclass or other issue
                results["confusion_matrix"] = {"raw_matrix": cm.tolist()}
        else:
             results["confusion_matrix"] = "Error: y_pred_class not generated."


    except Exception as e:
        print(f"Error calculating some metrics: {e}")
        results["error_metrics_calculation"] = str(e)

    print("Model evaluation finished.")
    return results

if __name__ == '__main__':
    # Example Usage
    class DummyModel:
        def __init__(self, model_type="sklearn_proba"):
            self.model_type = model_type # "sklearn_proba", "keras_like", "sklearn_no_proba"

        def predict(self, X):
            if self.model_type == "keras_like":
                return np.random.rand(len(X), 1) # Keras-like output
            # For sklearn_proba and sklearn_no_proba, predict returns class labels
            return (np.random.rand(len(X)) > 0.5).astype(int)

        def predict_proba(self, X):
            if self.model_type == "sklearn_proba":
                proba_pos = np.random.rand(len(X))
                return np.vstack([1 - proba_pos, proba_pos]).T # Standard sklearn format
            elif self.model_type == "sklearn_no_proba":
                raise AttributeError("'DummyModel' object has no attribute 'predict_proba' when type is sklearn_no_proba")
            # Keras models don't have predict_proba in the same way, handled by main predict()
            return None # Should not be called for keras_like if logic is correct

    num_samples = 100
    X_test_dummy = pd.DataFrame(np.random.rand(num_samples, 5), columns=[f'feat_{i}' for i in range(5)])
    y_test_dummy = pd.Series(np.random.randint(0, 2, num_samples))

    print("--- Testing Evaluator with a model that has predict_proba (sklearn_proba) ---")
    model_with_proba = DummyModel(model_type="sklearn_proba")
    eval_results_proba = evaluate_model(model_with_proba, X_test_dummy, y_test_dummy, model_type="dummy_sklearn_like")
    print("Evaluation Results (with predict_proba):")
    for metric, value in eval_results_proba.items():
        print(f"  {metric}: {value}")

    print("\n--- Testing Evaluator with a Keras-like model ---")
    model_keras_like = DummyModel(model_type="keras_like")
    eval_results_keras = evaluate_model(model_keras_like, X_test_dummy, y_test_dummy, model_type="neural_network")
    print("Evaluation Results (Keras-like):")
    for metric, value in eval_results_keras.items():
        print(f"  {metric}: {value}")

    print("\n--- Testing Evaluator with a model that only has predict (sklearn_no_proba) ---")
    model_no_proba = DummyModel(model_type="sklearn_no_proba")
    eval_results_no_proba = evaluate_model(model_no_proba, X_test_dummy, y_test_dummy, model_type="dummy_predict_only")
    print("Evaluation Results (predict_proba fails, uses predict):")
    for metric, value in eval_results_no_proba.items():
        print(f"  {metric}: {value}")

```
