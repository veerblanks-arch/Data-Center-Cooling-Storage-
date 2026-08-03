# Machine Learning Model Performance Write-Up

## Project Setup

The dataset is `data/source/cold_source_control_dataset.csv`, originally sourced from the ByteSmart internship Drive folder. The selected sample is created with a stratified split on `Cooling_Strategy_Action` so the sample keeps the same action-category balance as the larger dataset.

The three algorithms match the earlier notebook:

- Linear Regression predicts `Cooling_Power_kW`.
- K-Means groups operating conditions into clusters.
- Logistic Regression predicts whether the cooling action is `Increase Chiller` or another action.

## Sample Coverage

The combined notebook prints two coverage checks:

- Numeric min, max, and mean comparisons between the full dataset and selected sample.
- Cooling strategy percentage comparison between the full dataset and selected sample.

A good sample should have similar ranges and means for workload, inlet temperature, outlet temperature, ambient temperature, power, chiller usage, AHU usage, cost, and temperature deviation. The strategy distribution should also stay close, because the logistic model depends on seeing enough examples of each action type.

## Linear Regression

Linear Regression is used to predict cooling unit power consumption from operating conditions. It works by fitting the best straight-line relationship between the input variables and the target.

Performance should be judged with:

- R2: how much variation in cooling power the model explains.
- MAE: average absolute prediction error in kW.
- RMSE: larger-error-sensitive prediction error in kW.

If R2 is high and MAE/RMSE are small relative to the normal cooling-power range, the model is accurate enough for a basic prediction task. If not, the relationship is probably not purely linear or the feature set is missing important control-loop behavior.

## K-Means

K-Means is used for unsupervised clustering. It does not predict a labeled answer. Instead, it groups similar rows based on workload, temperatures, cooling usage, power, cost, and deviation.

Performance should be judged with:

- Silhouette score: whether rows fit well inside their assigned cluster.
- Visual separation: whether clusters show recognizable operating states.
- Engineering meaning: whether clusters correspond to low-load, normal-load, and high-stress cooling conditions.

K-Means can be useful for identifying operating modes, but it is sensitive to the number of clusters and to scaling. That is why the notebook uses `StandardScaler`.

## Logistic Regression

Logistic Regression predicts whether the cooling strategy should be `Increase Chiller`. It works by estimating the probability of a class, then classifying rows above the 0.5 decision threshold as positive.

Performance should be judged with:

- Accuracy: total correct predictions.
- Precision: when the model predicts `Increase Chiller`, how often it is right.
- Recall: how many actual `Increase Chiller` cases it catches.
- Confusion matrix: false positives and false negatives.

Accuracy alone can be misleading if the classes are imbalanced. For this cooling-control problem, recall matters because missing a real `Increase Chiller` case could mean the system fails to respond to heat stress.

## Issues and Limitations

The previous notebook used only the first 200 rows for visuals, which is not enough to prove broad dataset coverage. The new notebooks use a stratified sample from the full dataset and explicitly compare that sample back to the larger dataset.

Linear Regression may underfit if the control system behaves nonlinearly.

K-Means does not know the real cooling strategy labels, so its clusters need human interpretation.

Logistic Regression only predicts `Increase Chiller` versus other actions. It does not distinguish all five strategy actions unless it is changed into a multiclass model.

Important warning: the current feature set includes `Chiller_Usage` and `AHU_Usage`. That is useful for describing the existing operating state, but it may be too close to the decision being predicted. If the goal is to predict a future control action before the system changes usage levels, those columns should be removed or replaced with lagged values from earlier timestamps.

## Improvements

Better results could come from:

- Training on the full dataset instead of a small sample.
- Trying Random Forest or Gradient Boosting for nonlinear patterns.
- Predicting all cooling actions with multiclass classification.
- Adding time features such as hour of day, weekday, or rolling workload averages.
- Performing hyperparameter tuning with cross-validation.
- Checking class balance and using class weights if `Increase Chiller` is underrepresented.

## Monday Conceptual Notes

Linear Regression learns a weighted equation that predicts a numeric value. In this project, it estimates cooling power from sensor and usage variables.

K-Means chooses cluster centers, assigns each row to the nearest center, then moves the centers until the groups stabilize. In this project, it finds common operating conditions.

Logistic Regression predicts a probability for a category. In this project, it estimates the probability that the system should increase chiller usage.
