import React from 'react';
import Switch from '@material-ui/core/Switch';
import Card from '@material-ui/core/Card';
import CardContent from '@material-ui/core/CardContent';
import CardActions from '@material-ui/core/CardActions';
import Typography from "@material-ui/core/Typography";
import InputBase from "@material-ui/core/InputBase";
import Button from '@material-ui/core/Button';
import { makeStyles } from "@material-ui/core/styles";


const useStyles = makeStyles({
  root: {
    minWidth: 275,
    boxShadow: "0 4px 8px 0 rgba(0,0,0,0.2)",
    transition: "0.3s",
    width: "50%",
    marginTop: "20px",
    marginLeft: "25%",
    marginRight: "25%",
  },
});

export default function JustificationCard(justification, setJustification) {

  const [state, setState] = React.useState({
    checkedA: true,
    checkedB: true,
  });

  const handleChange = (event) => {
    setState({ ...state, [event.target.name]: event.target.checked });
  };
  const classes = useStyles();
  return (
    <Card className={classes.root} >
      <CardContent>
        <Typography variant="h4" component="h2" style={{ marginBottom: 12 }}>
          Justification
        </Typography>

        <Typography component="h2">
          Justification ID
        </Typography>
        <InputBase
          placeholder="12345..."
          classes={{
            root: classes.inputRoot,
            input: classes.inputInput,
          }}
        />
        <Typography component="h2">
          Justification Description
        </Typography>
        <InputBase
          placeholder="12345..."
          classes={{
            root: classes.inputRoot,
            input: classes.inputInput,
          }}
        />
      </CardContent>
      <CardActions>
        <Button variant="contained" color="primary">Save</Button>
      </CardActions>
    </Card >
  );
}